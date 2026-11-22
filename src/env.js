import fs from 'node:fs';
import path from 'node:path';

/**
 * Tiny .env loader — no dependency required.
 * Existing environment variables always win over values in the file.
 */
export function loadEnv(file = '.env') {
  const full = path.resolve(process.cwd(), file);
  if (!fs.existsSync(full)) return;

  for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && !(key in process.env)) process.env[key] = value;
  }
}

loadEnv();

const num = (value, fallback, min = 0, max = Infinity) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: num(process.env.PORT, 3000, 1, 65535),

  maxTextChars: num(process.env.MAX_TEXT_CHARS, 60000, 100, 1000000),
  maxBodyBytes: num(process.env.MAX_BODY_BYTES, 262144, 1024, 10485760),
  maxPolicyChars: num(process.env.MAX_POLICY_CHARS, 20000, 100, 500000),

  rateLimitWindowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 3600000, 1000, 86400000),
  rateLimitMax: num(process.env.RATE_LIMIT_MAX, 30, 1, 100000),

  /** e.g. https://your-frontend.example — leave empty for same-origin hosting. */
  allowedOrigin: process.env.ALLOWED_ORIGIN || '',

  /** auto | rules | openai */
  engine: (process.env.ANALYSIS_ENGINE || 'auto').toLowerCase(),
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  openaiTimeoutMs: num(process.env.OPENAI_TIMEOUT_MS, 30000, 1000, 120000),

  publicDir: path.resolve(process.cwd(), process.env.PUBLIC_DIR || 'public'),
};
