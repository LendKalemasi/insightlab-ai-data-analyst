import type { Fact, Grounding, Narrative, TableResult } from '../types';

/**
 * Checks that every number in an AI-written narrative can be traced to a
 * computed value. A number is accepted when it matches a fact, a table cell,
 * or a number in the user's question, allowing for the rounding implied by
 * how it was written ("1.2M" may stand for 1,234,567). Anything else is
 * reported as unverified and shown to the user next to the narrative.
 */
const NUMBER = /(?<![\w.])[-−]?[$€£]?\d[\d,]*(?:\.\d+)?\s*(?:%|k\b|m\b|bn\b|b\b|thousand\b|million\b|billion\b)?/gi;

interface Mention { text: string; value: number; tolerance: number; percent: boolean }

export function extractNumbers(text: string): Mention[] {
  const out: Mention[] = [];
  for (const match of text.matchAll(NUMBER)) {
    const raw = match[0].trim();
    const lower = raw.toLowerCase();
    const percent = lower.endsWith('%');
    const negative = /^[-−]/.test(raw);
    const digits = raw.replace(/^[-−]?[$€£]?/, '').replace(/[^\d.,]/g, '');
    if (/,\d{1,2}$/.test(digits) && !digits.includes('.')) continue; // ambiguous decimal comma
    const clean = digits.replace(/,/g, '');
    if (!clean || clean === '.') continue;
    let value = Number(clean);
    if (!Number.isFinite(value)) continue;
    const decimals = clean.includes('.') ? clean.split('.')[1].length : 0;
    let scale = 1;
    if (/(k|thousand)$/.test(lower)) scale = 1e3;
    else if (/(m|million)$/.test(lower)) scale = 1e6;
    else if (/(bn|b|billion)$/.test(lower)) scale = 1e9;
    value *= scale * (negative ? -1 : 1);
    // Half a unit in the last written digit, e.g. "1.2M" → ±50,000.
    const tolerance = 0.5 * 10 ** -decimals * scale;
    out.push({ text: raw, value, tolerance, percent });
  }
  return out;
}

function referenceNumbers(facts: Fact[], result: TableResult | null, question: string): number[] {
  const refs: number[] = [];
  const add = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) refs.push(v);
    else if (typeof v === 'string') for (const m of extractNumbers(v)) refs.push(m.value);
  };
  for (const f of facts) { add(f.value); add(f.display); add(f.detail ?? ''); add(f.label); }
  if (result) {
    add(result.row_count);
    for (const row of result.rows.slice(0, 1000)) for (const v of Object.values(row)) add(v);
  }
  for (const m of extractNumbers(question)) refs.push(m.value);
  return refs;
}

/** Small counts ("three regions", "top 5") and calendar years are not claims worth flagging. */
const trivial = (m: Mention) => !m.percent && Number.isInteger(m.value) && ((m.value >= 0 && m.value <= 12) || (m.value >= 1900 && m.value <= 2100));

export function checkGrounding(narrative: Narrative, facts: Fact[], result: TableResult | null, question: string): Grounding {
  const text = [narrative.headline, narrative.summary, ...narrative.insights.map((i) => i.text)].join('\n');
  const mentions = extractNumbers(text).filter((m) => !trivial(m));
  const refs = referenceNumbers(facts, result, question);
  const unverified: string[] = [];
  for (const m of mentions) {
    const ok = refs.some((r) => {
      const tol = Math.max(m.tolerance, Math.abs(r) * 0.0005);
      return Math.abs(r - m.value) <= tol || Math.abs(Math.abs(r) - Math.abs(m.value)) <= tol;
    });
    if (!ok && !unverified.includes(m.text)) unverified.push(m.text);
  }
  return { checked: mentions.length, unverified };
}
