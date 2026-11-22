import { server, handleApi } from './backend/server.js';
import { config } from './src/env.js';
import {
  HttpError,
  securityHeaders,
  sendJson,
  sendText,
  serveStatic,
} from './src/http-utils.js';

export default async function handler(req, res) {
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
      return res.end();
    }

    if (error instanceof HttpError) {
      for (const [key, value] of Object.entries(error.headers || {})) {
        res.setHeader(key, value);
      }
      if (pathname.startsWith('/api/')) {
        return sendJson(res, error.status, { error: error.message });
      }
      return sendText(res, error.status, error.message);
    }

    console.error('[clause-guard]', error);
    if (pathname.startsWith('/api/')) {
      return sendJson(res, 500, { error: 'Internal server error.' });
    }
    return sendText(res, 500, 'Internal server error.');
  }
}

export { server };
