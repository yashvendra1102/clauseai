import http from 'node:http';
import { fileURLToPath } from 'node:url';

import { config } from './src/env.js';
import { analyzeContract } from './src/analyzer.js';
import { createRateLimiter } from './src/rate-limiter.js';
import {
  HttpError,
  applyCors,
  clientIp,
  readJsonBody,
  securityHeaders,
  sendJson,
  sendText,
  serveStatic,
} from './src/http-utils.js';

export { createRateLimiter };

const VERSION = '1.0.0';

export const checkRate = createRateLimiter(config.rateLimitWindowMs, config.rateLimitMax);

export function activeEngine() {
  if (config.engine === 'rules') return 'rules';
  if (config.engine === 'openai') return 'openai';
  return config.openaiApiKey ? 'openai' : 'rules';
}

export async function handleAnalyze(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    throw new HttpError(405, 'Method not allowed. Use POST for /api/analyze.');
  }

  const rate = checkRate(clientIp(req));
  res.setHeader('X-RateLimit-Limit', String(rate.limit));
  res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(rate.reset / 1000)));

  if (!rate.allowed) {
    throw new HttpError(429, 'Rate limit reached. Please wait a moment and try again.');
  }

  const body = await readJsonBody(req, config.maxBodyBytes);

  if (typeof body.text !== 'string' || !body.text.trim()) {
    throw new HttpError(400, 'Field "text" must be a non-empty string.');
  }
  if (body.text.length > config.maxTextChars) {
    throw new HttpError(
      413,
      `Contract text is too long. Maximum ${config.maxTextChars} characters.`
    );
  }
  if (body.policy !== undefined && typeof body.policy !== 'string') {
    throw new HttpError(400, 'Field "policy" must be a string when provided.');
  }
  if (typeof body.policy === 'string' && body.policy.length > config.maxPolicyChars) {
    throw new HttpError(
      413,
      `Policy text is too long. Maximum ${config.maxPolicyChars} characters.`
    );
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
}

export async function handleApi(req, res, pathname) {
  applyCors(req, res, config);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      Allow: 'GET, POST, OPTIONS',
      'Cache-Control': 'no-store',
    });
    return res.end();
  }

  if (pathname === '/api/health' && (req.method === 'GET' || req.method === 'HEAD')) {
    return sendJson(res, 200, {
      ok: true,
      version: VERSION,
      engine: activeEngine(),
      maxTextChars: config.maxTextChars,
      now: new Date().toISOString(),
    });
  }

  if (pathname === '/api/config' && (req.method === 'GET' || req.method === 'HEAD')) {
    return sendJson(res, 200, {
      engine: activeEngine(),
      maxTextChars: config.maxTextChars,
      rateLimit: { max: config.rateLimitMax, windowMs: config.rateLimitWindowMs },
      version: VERSION,
    });
  }

  if (pathname === '/api/analyze') {
    return handleAnalyze(req, res);
  }

  res.setHeader('Allow', 'GET, POST, OPTIONS');
  throw new HttpError(404, 'Unknown API endpoint.');
}

export const server = http.createServer(async (req, res) => {
  securityHeaders(res);

  let pathname = '/';
  try {
    pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
  } catch {
    return sendText(res, 400, 'Malformed URL.');
  }

  try {
    if (pathname.startsWith('/api/')) {
      return await handleApi(req, res, pathname);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return sendText(res, 405, 'Method not allowed.');
    }

    return await serveStatic(req, res, config.publicDir, pathname);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }

    if (error instanceof HttpError) {
      for (const [key, value] of Object.entries(error.headers)) {
        res.setHeader(key, value);
      }
      if (pathname.startsWith('/api/')) {
        return sendJson(res, error.status, { error: error.message });
      }
      return sendText(res, error.status, error.message);
    }

    console.error('[clause-guard]', error);
    if (pathname.startsWith('/api/')) {
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
    return sendText(res, 500, 'Internal server error.');
  }
});

// Configure server timeouts to prevent slowloris/socket-exhaustion attacks
server.requestTimeout = 30000;
server.headersTimeout = 35000;
server.keepAliveTimeout = 5000;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[clause-guard] Port ${config.port} is already in use. Choose another port with PORT=<port>.`);
  } else {
    console.error('[clause-guard] Server error:', err);
  }
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('[clause-guard] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[clause-guard] Unhandled rejection:', reason);
});

function gracefulShutdown() {
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Only listen if executed directly as entrypoint (not when imported by tests or serverless handlers)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  server.listen(config.port, config.host, () => {
    const url = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
    console.log(`Clause Guard backend listening on ${url}`);
    console.log(`Analysis engine: ${activeEngine()}`);
  });
}
