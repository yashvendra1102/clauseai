import { config } from '../src/env.js';
import { activeEngine } from '../server.js';
import { applyCors, securityHeaders, sendJson } from '../src/http-utils.js';

const VERSION = '1.0.0';

export default async function handler(req, res) {
  securityHeaders(res);
  applyCors(req, res, config);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      Allow: 'GET, HEAD, OPTIONS',
      'Cache-Control': 'no-store',
    });
    return res.end();
  }

  return sendJson(res, 200, {
    engine: activeEngine(),
    maxTextChars: config.maxTextChars,
    rateLimit: { max: config.rateLimitMax, windowMs: config.rateLimitWindowMs },
    version: VERSION,
  });
}
