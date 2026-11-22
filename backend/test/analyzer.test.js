import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeContract,
  deriveTitle,
  normalizeLevel,
  normalizeRisks,
  parseModelJson,
  ruleBasedAnalysis,
} from '../src/analyzer.js';
import { createRateLimiter } from '../src/rate-limiter.js';
import { clientIp, HttpError, serveStatic } from '../src/http-utils.js';

const SAMPLE = `RESIDENTIAL LEASE AGREEMENT

1. TERM AND RENEWAL. The initial term is twelve (12) months. Unless the Tenant delivers written notice of non-renewal at least ninety (90) days before the end of the current term, this Lease shall renew automatically for successive twelve (12) month terms on the same conditions, and the Landlord may increase the rent by up to ten percent (10%) upon each renewal.

2. RENT AND LATE FEES. Monthly rent of $1,850 is due on the first day of each month. Any payment received after the third day of the month shall incur a late fee equal to fifteen percent (15%) of the monthly rent, plus interest at two percent (2%) per month, compounded monthly, until paid in full.

3. SECURITY DEPOSIT. The deposit will be returned within thirty (30) days of move-out, less documented costs of repair beyond normal wear and tear, with an itemized statement.

4. TERMINATION. The Landlord may terminate this Agreement at any time, for any reason, upon thirty (30) days' written notice. The Tenant may terminate only at the end of the initial term.

5. LIABILITY. The Tenant shall be fully liable for any and all damages, without any limitation or cap, including damages arising from conditions of the building.

6. INDEMNIFICATION. The Tenant agrees to indemnify the Landlord from any and all claims, including claims arising in whole or in part from the negligence of the Landlord.

7. GOVERNING LAW AND VENUE. Any dispute shall be brought exclusively in the state or federal courts located in Wilmington, Delaware.`;

test('deriveTitle cleans an all-caps document heading', () => {
  assert.equal(deriveTitle(SAMPLE), 'Residential Lease Agreement');
});

test('normalizeLevel only allows high, medium, and ok', () => {
  assert.equal(normalizeLevel('HIGH'), 'high');
  assert.equal(normalizeLevel('ok'), 'ok');
  assert.equal(normalizeLevel('critical'), 'medium');
  assert.equal(normalizeLevel(undefined), 'medium');
});

test('normalizeRisks always returns the dashboard fields', () => {
  const risks = normalizeRisks([{ level: 'HIGH', title: 'Example', extra: 'ignored' }]);
  assert.deepEqual(risks[0], {
    level: 'high',
    title: 'Example',
    section: '',
    quote: '',
    found: '',
    rule: '',
    plain: '',
  });
});

test('rule-based analysis detects the sample risks and positive checks', () => {
  const result = ruleBasedAnalysis(SAMPLE, '');
  const titles = result.risks.map((r) => r.title).join(' | ');

  assert.match(titles, /Automatic renewal/i);
  assert.match(titles, /late fee/i);
  assert.match(titles, /termination/i);
  assert.match(titles, /liability/i);
  assert.match(titles, /indemnity/i);
  assert.match(titles, /venue/i);
  assert.match(titles, /Deposit refund/i);

  const levels = result.risks.map((r) => r.level);
  assert.equal(levels[0], 'high');
  assert.ok(levels.includes('medium'));
  assert.ok(levels.includes('ok'));

  for (const risk of result.risks) {
    if (risk.quote) {
      assert.ok(SAMPLE.includes(risk.quote), `quote not found verbatim: ${risk.quote}`);
    }
  }
});

test('policy thresholds are respected', () => {
  const policy = '3. LATE FEES. Late fees above 50% or interest above 20% per month are excessive.';
  const result = ruleBasedAnalysis(SAMPLE, policy);
  const late = result.risks.find((r) => /late fee/i.test(r.title));

  assert.ok(late);
  assert.equal(late.level, 'medium');
  assert.match(late.rule, /50%/);
});

test('analyzeContract uses local rules by default', async () => {
  const result = await analyzeContract({ text: SAMPLE, engine: 'rules' });
  assert.equal(result.engine, 'rules');
  assert.ok(result.risks.length >= 3);
});

test('analyzeContract falls back to rules when auto mode AI fails', async () => {
  const failingFetch = async () => ({ ok: false, status: 500, text: async () => 'nope' });
  const result = await analyzeContract({
    text: SAMPLE,
    engine: 'auto',
    apiKey: 'test-key',
    fetchImpl: failingFetch,
  });

  assert.equal(result.engine, 'rules');
  assert.match(result.notice, /local policy rules/i);
});

test('parseModelJson handles fenced JSON and conversational preamble', () => {
  const output = 'Here is the analysis:\n```json\n{"title":"Test Doc","risks":[]}\n```\nHope this helps!';
  const parsed = parseModelJson(output);
  assert.equal(parsed.title, 'Test Doc');
  assert.deepEqual(parsed.risks, []);
});

test('analyzeContract handles timeout when upstream hangs', async () => {
  const hangingFetch = (_url, { signal }) =>
    new Promise((_, reject) => {
      signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });

  const result = await analyzeContract({
    text: SAMPLE,
    engine: 'auto',
    apiKey: 'test-key',
    timeoutMs: 50,
    fetchImpl: hangingFetch,
  });

  assert.equal(result.engine, 'rules');
  assert.match(result.notice, /local policy rules/i);
});

test('createRateLimiter limits requests and bounds memory map size', () => {
  const limiter = createRateLimiter(60000, 2, 5);
  // IP 1: allowed 2 times, then blocked
  const res1 = limiter('1.1.1.1');
  assert.equal(res1.allowed, true);
  const res2 = limiter('1.1.1.1');
  assert.equal(res2.allowed, true);
  const res3 = limiter('1.1.1.1');
  assert.equal(res3.allowed, false);

  // Exceed max entries to verify eviction without crashing
  for (let i = 0; i < 15; i++) {
    limiter(`10.0.0.${i}`);
  }
});

test('clientIp sanitizes and bounds forwarded IP headers', () => {
  const fakeReq = {
    headers: {
      'x-forwarded-for': '  192.168.1.1; DROP TABLE users; ' + 'a'.repeat(200),
    },
    socket: { remoteAddress: '127.0.0.1' },
  };
  const ip = clientIp(fakeReq);
  assert.ok(ip.length <= 64);
  assert.ok(!ip.includes(';'));
});

test('serveStatic rejects null bytes with 400', async () => {
  await assert.rejects(
    async () => {
      await serveStatic({}, {}, 'public', '/test\0.html');
    },
    (err) => err instanceof HttpError && err.status === 400
  );
});
