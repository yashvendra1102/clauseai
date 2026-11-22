/**
 * Clause Guard AI analysis engine.
 *
 * Two modes:
 *   1. Local rule-based checks (default) — works offline, no API key needed.
 *   2. OpenAI-backed analysis — enabled when an API key is supplied.
 *
 * Both return the shape the dashboard expects:
 *   { title, risks: [{ level, title, section, quote, found, rule, plain }] }
 */

const LEVEL_ORDER = { high: 0, medium: 1, ok: 2 };
const SMALL_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'at', 'by',
  'with', 'as', 'is', 'be', 'from', 'into', 'per', 'its',
]);

const clean = (value, fallback = '') =>
  typeof value === 'string' ? value.trim() : fallback;

export function normalizeLevel(level) {
  const l = String(level || '').toLowerCase();
  return l === 'high' || l === 'ok' ? l : 'medium';
}

export function normalizeRisks(list) {
  if (!Array.isArray(list)) return [];
  return list.map((r) => ({
    level: normalizeLevel(r?.level),
    title: clean(r?.title, 'Untitled check'),
    section: clean(r?.section),
    quote: clean(r?.quote),
    found: clean(r?.found),
    rule: clean(r?.rule),
    plain: clean(r?.plain),
  }));
}

function toTitleCase(input) {
  return String(input)
    .toLowerCase()
    .replace(/\b[\p{L}\p{N}]+\b/gu, (word, offset) =>
      offset > 0 && SMALL_WORDS.has(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1)
    );
}

export function deriveTitle(text) {
  const firstLine =
    String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || '';

  const stripped = firstLine.replace(/^\s*\d+[\.\)]\s*/, '').slice(0, 100);
  if (/^[A-Z0-9 ,.&'’\-]+$/.test(stripped) && stripped.length > 3) {
    return toTitleCase(stripped);
  }
  return stripped || 'Contract review';
}

function find(text, regex) {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const re = new RegExp(regex.source, flags);
  re.lastIndex = 0;
  return re.exec(String(text || ''));
}

function percentages(text) {
  return [...String(text || '').matchAll(/(\d+(?:\.\d+)?)\s*%/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n));
}

function parseNoticeDays(text) {
  const s = String(text || '');
  const paren = s.match(/\((\d{1,3})\)\s*days?/i) || s.match(/\b(\d{1,3})\s*days?/i);
  if (paren) return Number(paren[1]);

  const words = {
    thirty: 30,
    'forty-five': 45,
    'forty five': 45,
    fortyfive: 45,
    sixty: 60,
    ninety: 90,
    'one hundred twenty': 120,
  };
  const word = s.match(/\b(thirty|forty[- ]?five|sixty|ninety|one hundred twenty)\b/i);
  return word ? words[word[1].toLowerCase()] || null : null;
}

function quoteAround(text, index, length) {
  const source = String(text || '');
  const before = source.slice(0, index);
  const after = source.slice(index + length);

  const nl = before.lastIndexOf('\n');
  const dot = before.lastIndexOf('. ');
  const semi = before.lastIndexOf('; ');
  const starts = [
    nl === -1 ? -1 : nl + 1,
    dot === -1 ? -1 : dot + 2,
    semi === -1 ? -1 : semi + 2,
  ];
  const start = Math.max(0, ...starts);

  const period = after.search(/[.!?](?:\s|$)/);
  const newline = after.search(/\r?\n/);
  const ends = [];
  if (period !== -1) ends.push(period + 1);
  if (newline !== -1) ends.push(newline);
  const end = ends.length
    ? Math.min(source.length, index + length + Math.min(...ends))
    : Math.min(source.length, index + length);

  let quote = source.slice(start, end).trim();
  if (quote.length > 360) quote = `${quote.slice(0, 357).trimEnd()}…`;
  return quote;
}

function sectionFor(text, index) {
  const lines = String(text || '')
    .slice(0, index)
    .split(/\r?\n/);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    const match = line.match(/^(\d{1,2})[\.\)]\s+(.+?)\s*[.:]?$/);
    if (match && match[2].length <= 90) {
      return `Section ${match[1]} · ${toTitleCase(match[2].replace(/[.:]+$/, ''))}`;
    }
  }
  return '';
}

function riskFromMatch(text, match, base) {
  return {
    ...base,
    section: sectionFor(text, match.index),
    quote: quoteAround(text, match.index, match[0].length),
  };
}

function thresholdsFromPolicy(policy) {
  const thresholds = {
    lateFeePct: 5,
    interestPct: 2,
    renewalNoticeDays: 30,
  };
  if (!policy) return thresholds;

  const lines = String(policy)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const lateLine = lines.find((line) => /late\s+fee|interest/i.test(line));
  if (lateLine) {
    const nums = percentages(lateLine);
    const monthly = lateLine.match(/(\d+(?:\.\d+)?)\s*%\s*per\s*month/i);
    if (nums[0] !== undefined) thresholds.lateFeePct = nums[0];
    if (monthly) thresholds.interestPct = Number(monthly[1]);
    else if (nums[1] !== undefined) thresholds.interestPct = nums[1];
  }

  const renewalLine = lines.find((line) => /renew|notice window/i.test(line));
  if (renewalLine) {
    const days = parseNoticeDays(renewalLine);
    if (days !== null) thresholds.renewalNoticeDays = days;
  }

  return thresholds;
}

/* --------------------------- risk detectors --------------------------- */

function detectAutoRenewal(text, thresholds) {
  const match = find(
    text,
    /\b(?:automatic(?:ally)?\s+renew(?:al|ed|s)?|renew(?:s|ed)?\s+automatically|successive\s+(?:\w+\s+){0,3}(?:month|year|term)s?|renew(?:al)?\s+for\s+successive)\b/i
  );
  if (!match) return null;

  const clause = quoteAround(text, match.index, match[0].length);
  const days = parseNoticeDays(clause);
  const rentIncrease = /increase the rent|rent may (?:be )?increase|\b\d{1,2}\s*%\s*(?:increase|rise)/i.test(clause);
  const longNotice = days !== null && days > thresholds.renewalNoticeDays;

  return riskFromMatch(text, match, {
    level: longNotice || rentIncrease ? 'high' : 'medium',
    title: longNotice
      ? `Automatic renewal with a ${days}-day notice trap`
      : rentIncrease
        ? 'Automatic renewal with a rent increase'
        : 'Automatic renewal without explicit consent',
    found: longNotice
      ? `The agreement renews by itself unless you give notice ${days} days ahead${rentIncrease ? ', and the price can rise at renewal' : ''}.`
      : 'The agreement can renew automatically instead of requiring your explicit consent.',
    rule: `Policy 1 — renewal should need explicit consent; notice windows over ${thresholds.renewalNoticeDays} days are a risk.`,
    plain: longNotice
      ? `If you do nothing, you are locked in for another whole term. You have to warn the other side ${days} days before it ends, and your price can still go up.`
      : 'If you do nothing, the agreement can roll over for another term. You may need to give notice well in advance to stop it.',
  });
}

function detectLateFees(text, thresholds) {
  const match = find(
    text,
    /\b(?:late\s+fee|late\s+charge|interest\s+(?:at|of)\s+\d+(?:\.\d+)?\s*%|compounded\s+monthly)\b/i
  );
  if (!match) return null;

  const clause = quoteAround(text, match.index, match[0].length);
  const nums = percentages(clause);
  const fee = nums.find((n) => n >= 1 && n <= 100);
  const interest = nums.filter((n) => n >= 1 && n <= 100)[1];
  const compounding = /compounded\s+monthly/i.test(clause);
  const high =
    (fee !== undefined && fee > thresholds.lateFeePct) ||
    (interest !== undefined && interest > thresholds.interestPct);

  return riskFromMatch(text, match, {
    level: high ? 'high' : 'medium',
    title: high ? 'Steep late fee or compounding interest' : 'Late fee and interest terms',
    found: high
      ? `Late charges include ${fee !== undefined ? `${fee}% of the amount due` : 'a percentage fee'}${interest !== undefined ? ` plus ${interest}% monthly interest` : ''}${compounding ? ', compounded monthly' : ''}.`
      : 'The agreement charges an extra amount when payments are late.',
    rule: `Policy 3 — late fees above ${thresholds.lateFeePct}% or interest above ${thresholds.interestPct}% per month are excessive.`,
    plain: high
      ? 'Paying late can cost a large one-off fee, and the balance can keep growing every month on top.'
      : 'Late payments can add extra charges, so check the exact percentage before you agree.',
  });
}

function detectTermination(text) {
  const match =
    find(text, /\b(?:may|can)\s+terminate\s+(?:this\s+)?(?:agreement|lease|contract)\s+at\s+any\s+time\b/i) ||
    find(text, /\bterminat(?:e|ion)\b[^.\n]{0,140}\b(?:only|solely)\b[^.\n]{0,140}\bterminat(?:e|ion)\b/i);
  if (!match) return null;

  return riskFromMatch(text, match, {
    level: 'high',
    title: 'One-sided termination rights',
    found: 'One party can end the agreement at any time, while the other is limited to specific windows.',
    rule: 'Policy 4 — termination rights should be broadly mutual.',
    plain: 'One side can walk away quickly for any reason, but you may not get the same freedom to leave.',
  });
}

function detectLiability(text) {
  const match = find(
    text,
    /\b(?:without\s+(?:any\s+)?limitation\s+or\s+cap|unlimited\s+liability|uncapped\s+liability|fully\s+liable\b[^.\n]{0,140}\bwithout\b)/i
  );
  if (!match) return null;

  return riskFromMatch(text, match, {
    level: 'high',
    title: 'Uncapped or unlimited liability',
    found: 'The liability clause has no upper limit, so exposure is not capped.',
    rule: 'Policy 2 — liability should be capped; unlimited exposure is a high risk.',
    plain: 'There is no ceiling on what you could have to pay if something goes wrong.',
  });
}

function detectIndemnity(text) {
  const match = find(text, /\bindemnif(?:y|ication|ied)\b/i);
  if (!match) return null;

  const clause = quoteAround(text, match.index, match[0].length);
  const coversOtherNegligence =
    /\bnegligence of the (?:landlord|other party|company|supplier)\b/i.test(clause) ||
    /\b(?:other party'?s|their) own negligence\b/i.test(clause) ||
    /\bincluding claims arising in whole or in part from the negligence\b/i.test(clause);
  const oneSided =
    /\b(?:tenant|customer|employee|licensee|you)\b[^.\n]{0,100}\bindemnif/i.test(clause);

  return riskFromMatch(text, match, {
    level: coversOtherNegligence || oneSided ? 'high' : 'medium',
    title: coversOtherNegligence
      ? 'Indemnity covers the other party’s negligence'
      : 'Broad or one-sided indemnity',
    found: coversOtherNegligence
      ? 'The indemnity can require you to cover claims caused by the other party’s own negligence.'
      : 'The indemnity obligation is broad and may not be mutual.',
    rule: 'Policy 5 — indemnity should be mutual, limited to third-party claims, and never cover the other party’s own negligence.',
    plain: coversOtherNegligence
      ? 'You could end up paying the other side’s legal costs even when they were the ones who did something wrong.'
      : 'You may be promising to cover costs that would normally belong to the other side.',
  });
}

function detectJurisdiction(text) {
  const match = find(text, /\b(?:governing law|venue|courts located in|exclusive jurisdiction)\b/i);
  if (!match) return null;

  const clause = quoteAround(text, match.index, match[0].length);
  const exclusive = /\bexclusively\b|\bsole\b/i.test(clause);

  return riskFromMatch(text, match, {
    level: 'medium',
    title: exclusive ? 'Exclusive or distant court venue' : 'Governing law and venue clause',
    found: 'Disputes must be handled under a specific law and in a specific location.',
    rule: 'Policy 6 — venue should be where the customer lives or where the property is located.',
    plain: 'If there is a disagreement, you may have to deal with it in a court that is far away from you.',
  });
}

function detectDepositRefund(text) {
  const match = find(
    text,
    /\b(?:deposit|security deposit)\b[^.\n]{0,180}\breturned within\b|\breturned within\b[^.\n]{0,80}\bdays?\b/i
  );
  if (!match) return null;

  return riskFromMatch(text, match, {
    level: 'ok',
    title: 'Deposit refund terms look fair',
    found: 'The deposit is returned within a stated period with deductions documented.',
    rule: 'Policy 7 — prompt, itemized deposit refunds are a positive sign.',
    plain: 'Your deposit rules look normal: you get it back within a stated time, minus clearly explained costs.',
  });
}

function detectDeletionRights(text) {
  const match = find(text, /\b(?:delete|deletion)\b[^.\n]{0,140}\b(?:account|personal data|data)\b/i);
  if (!match) return null;

  return riskFromMatch(text, match, {
    level: 'ok',
    title: 'Clear right to deletion',
    found: 'You can delete your account or personal data within a stated period.',
    rule: 'Policy 7 — clear deletion rights are a positive sign.',
    plain: 'You can remove your data yourself, and there is a clear promise about when it will be gone.',
  });
}

function detectEncryption(text) {
  const match = find(text, /\bencrypt(?:ed|ion|s)?\b/i);
  if (!match) return null;

  return riskFromMatch(text, match, {
    level: 'ok',
    title: 'Security practices are stated',
    found: 'The agreement states that data is encrypted in transit and at rest.',
    rule: 'Policy 7 — stated security practices are a positive sign.',
    plain: 'The other side has clearly said that your data is scrambled to keep it safe.',
  });
}

function detectReimbursement(text) {
  const match = find(text, /\b(?:reimbursed|reimbursement)\b[^.\n]{0,140}\bwithin\b/i);
  if (!match) return null;

  return riskFromMatch(text, match, {
    level: 'ok',
    title: 'Prompt reimbursement',
    found: 'Expenses or amounts owed are reimbursed within a stated period.',
    rule: 'Policy 7 — prompt reimbursement is a positive sign.',
    plain: 'You should get your money back within a defined time, rather than whenever someone gets around to it.',
  });
}

const RISK_DETECTORS = [
  detectAutoRenewal,
  detectLateFees,
  detectTermination,
  detectLiability,
  detectIndemnity,
  detectJurisdiction,
];

const POSITIVE_DETECTORS = [
  detectDepositRefund,
  detectDeletionRights,
  detectEncryption,
  detectReimbursement,
];

export function ruleBasedAnalysis(text, policy) {
  const thresholds = thresholdsFromPolicy(policy);
  const risks = [];

  for (const detector of RISK_DETECTORS) {
    const risk = detector(text, thresholds);
    if (risk) risks.push(risk);
  }

  const positives = [];
  for (const detector of POSITIVE_DETECTORS) {
    const risk = detector(text, thresholds);
    if (risk) positives.push(risk);
  }
  risks.push(...positives.slice(0, 2));

  const seen = new Set();
  const unique = risks.filter((risk) => {
    const key = `${risk.title}|${risk.quote}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  unique.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

  return {
    title: deriveTitle(text),
    risks: normalizeRisks(unique),
  };
}

/* ---------------------------- OpenAI mode ---------------------------- */

export function parseModelJson(content) {
  let raw = String(content || '').trim();
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(raw);
  } catch (e) {
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
      } catch {
        // fall through
      }
    }
    throw new Error(`Failed to parse AI response as JSON: ${e.message}`);
  }
}

export async function openAIAnalysis({
  text,
  policy,
  apiKey,
  model = 'gpt-4o-mini',
  timeoutMs = 30000,
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is missing.');

  const system = [
    'You are Clause Guard AI, a careful contract-risk reviewer.',
    'You are not a lawyer and must not claim to give legal advice.',
    'Return ONLY a JSON object with this exact shape:',
    '{"title":"short document title","risks":[{"level":"high|medium|ok","title":"short label","section":"optional section name","quote":"EXACT text copied from the contract","found":"what the clause says","rule":"policy rule applied","plain":"plain-English explanation"}]}',
    'Rules:',
    '- Use "high" for serious one-sided or uncapped terms, "medium" for caution-worthy terms, and "ok" for genuinely fair or protective terms.',
    '- Every non-empty "quote" must be copied verbatim from the contract so it can be highlighted.',
    '- Sort risks high, then medium, then ok.',
    '- Include between 3 and 10 risks. Never invent facts.',
  ].join('\n');

  const user = [
    'POLICY RULES:',
    policy || 'Use a balanced, customer-friendly standard policy.',
    '',
    'CONTRACT TEXT:',
    text,
  ].join('\n');

  let signal;
  try {
    signal = AbortSignal.timeout(timeoutMs);
  } catch {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), timeoutMs).unref();
    signal = controller.signal;
  }

  let response;
  try {
    response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      throw new Error(`OpenAI request timed out after ${timeoutMs}ms.`);
    }
    throw new Error(`OpenAI network request failed: ${err.message}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`OpenAI request failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  const parsed = parseModelJson(content);

  if (!parsed || !Array.isArray(parsed.risks)) {
    throw new Error('OpenAI response did not contain a risks array.');
  }

  return {
    title: clean(parsed.title, deriveTitle(text)),
    risks: normalizeRisks(parsed.risks),
  };
}

/**
 * Main entry point used by the server.
 */
export async function analyzeContract({
  text,
  policy = '',
  engine = 'auto',
  apiKey = '',
  model = 'gpt-4o-mini',
  timeoutMs = 30000,
  fetchImpl = fetch,
}) {
  const useAi = engine === 'openai' || (engine === 'auto' && Boolean(apiKey));

  if (useAi) {
    try {
      const result = await openAIAnalysis({ text, policy, apiKey, model, timeoutMs, fetchImpl });
      return { ...result, engine: 'openai' };
    } catch (error) {
      if (engine === 'openai') throw error;
      return {
        ...ruleBasedAnalysis(text, policy),
        engine: 'rules',
        notice: 'AI provider was unavailable, so local policy rules were used instead.',
      };
    }
  }

  return { ...ruleBasedAnalysis(text, policy), engine: 'rules' };
}
