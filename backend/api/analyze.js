import { config } from '../src/env.js';
import { handleAnalyze } from '../server.js';
import { applyCors, HttpError, securityHeaders, sendJson } from '../src/http-utils.js';

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

  try {
    return await handleAnalyze(req, res);
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
