import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

export class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

export function securityHeaders(res) {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

export function applyCors(req, res, config = {}) {
  const origin = req.headers.origin;
  const allowed = config.allowedOrigin || '*';

  if (allowed === '*') {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  } else if (!origin || origin === allowed) {
    res.setHeader('Access-Control-Allow-Origin', allowed);
    res.setHeader('Vary', 'Origin');
  } else {
    return;
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '600');
}

export function sendJson(res, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export function sendText(res, status, text, headers = {}) {
  const body = Buffer.from(String(text));
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    ...headers,
  });
  res.end(body);
}

export async function readJsonBody(req, maxBytes) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body) && !Array.isArray(req.body)) {
      return req.body;
    }
    if (typeof req.body === 'string') {
      try {
        const parsed = JSON.parse(req.body);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch {
        throw new HttpError(400, 'Request body must be valid JSON.');
      }
    }
  }

  const chunks = [];
  let size = 0;

  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        throw new HttpError(413, `Request body is too large. Maximum ${maxBytes} bytes.`);
      }
      chunks.push(chunk);
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'Error reading request body.');
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) {
    throw new HttpError(400, 'Request body is empty. Send JSON with a "text" field.');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }

  return parsed;
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const first = forwarded.split(',')[0].trim();
    return first.slice(0, 64).replace(/[^\w.:%-]/g, '');
  }
  const remote = req.socket?.remoteAddress;
  return typeof remote === 'string' ? remote.slice(0, 64) : 'unknown';
}

export async function serveStatic(req, res, publicDir, pathname) {
  if (pathname.includes('\0')) {
    throw new HttpError(400, 'Malformed URL.');
  }

  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'Malformed URL.');
  }

  if (decoded.includes('\0')) {
    throw new HttpError(400, 'Malformed URL.');
  }

  const requested = decoded.replace(/\\/g, '/').replace(/^\/+/, '') || 'index.html';
  const root = path.resolve(publicDir);
  const full = path.resolve(root, requested);

  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new HttpError(403, 'Forbidden.');
  }

  let stat;
  try {
    stat = await fs.promises.stat(full);
  } catch {
    throw new HttpError(404, 'Not found.');
  }

  let file = full;
  if (stat.isDirectory()) {
    file = path.join(full, 'index.html');
    try {
      stat = await fs.promises.stat(file);
    } catch {
      throw new HttpError(404, 'Not found.');
    }
  }

  if (!stat.isFile()) throw new HttpError(404, 'Not found.');

  const ext = path.extname(file).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', ext === '.html' ? 'no-cache' : 'public, max-age=3600');

  if (req.method === 'HEAD') {
    res.writeHead(200);
    return res.end();
  }

  const stream = fs.createReadStream(file);
  try {
    await pipeline(stream, res);
  } catch (err) {
    if (err.code !== 'ERR_STREAM_PREMATURE_CLOSE' && err.code !== 'ECONNRESET') {
      throw err;
    }
  }
}
