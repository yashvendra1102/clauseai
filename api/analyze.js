import { config } from '../src/env.js';
import { analyzeContract } from '../src/analyzer.js';
import { createRateLimiter } from '../src/rate-limiter.js';
import {
  HttpError,
  applyCors,
  clientIp,
  readJsonBody,
  securityHeaders,
  sendJson,
} from '../src/http-utils.js';

const checkRate = createRateLimiter(config.rateLimitWindowMs, config.rateLimitMax);

export default async function handler(req, res) {
  securityHeaders(res);
  applyCors(req, res, config);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      Allow: 'POST, OPTIONS',
      'Cache-Control': 'no-store',
    });
    return res.end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed. Use POST for /api/analyze.' });
  }

  try {
    const rate = checkRate(clientIp(req));
    res.setHeader('X-RateLimit-Limit', String(rate.limit));
    res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(rate.reset / 1000)));

    if (!rate.allowed) {
      return sendJson(res, 429, { error: 'Rate limit reached. Please wait a moment and try again.' });
    }

    const body = await readJsonBody(req, config.maxBodyBytes);

    if (typeof body.text !== 'string' || !body.text.trim()) {
      return sendJson(res, 400, { error: 'Field "text" must be a non-empty string.' });
    }
    if (body.text.length > config.maxTextChars) {
      return sendJson(res, 413, { error: `Contract text is too long. Maximum ${config.maxTextChars} characters.` });
    }
    if (body.policy !== undefined && typeof body.policy !== 'string') {
      return sendJson(res, 400, { error: 'Field "policy" must be a string when provided.' });
    }
    if (typeof body.policy === 'string' && body.policy.length > config.maxPolicyChars) {
      return sendJson(res, 413, { error: `Policy text is too long. Maximum ${config.maxPolicyChars} characters.` });
    }

    const result = await analyzeContract({
      text: body.text,
      policy: body.policy || '',
      engine: config.engine,
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      timeoutMs: config.openaiTimeoutMs,
    });

    return sendJson(res, 200, {
      title: result.title,
      risks: result.risks,
      engine: result.engine,
      ...(result.notice ? { notice: result.notice } : {}),
    });
  } catch (error) {
    if (res.headersSent) {
      return res.end();
    }
    if (error instanceof HttpError) {
      for (const [key, value] of Object.entries(error.headers || {})) {
        res.setHeader(key, value);
      }
      return sendJson(res, error.status, { error: error.message });
    }

    console.error('[clause-guard API]', error);
    const isProviderError =
      error?.message?.includes('OpenAI') ||
      error?.message?.includes('AI response') ||
      error?.message?.includes('timed out');
    return sendJson(res, isProviderError ? 502 : 500, {
      error: isProviderError
        ? `The analysis provider failed (${error.message}). Please try again, or use ANALYSIS_ENGINE=rules.`
        : 'Internal server error.',
    });
  }
}
