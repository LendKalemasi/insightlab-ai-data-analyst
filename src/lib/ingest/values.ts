import type { ColumnType } from '../types';

/**
 * Column-level value parsing and type inference.
 *
 * Every decision is made per column, from all of its values, so a column is
 * stored with one consistent type. Values that do not fit the inferred type are
 * stored as missing and counted in `unparseable`, which surfaces as a
 * data-quality issue rather than silently disappearing.
 */

export type Cell = string | number | boolean | Date | null | undefined;
export type StoredValue = string | number | null;

export interface NormalizedColumn {
  name: string;
  original_name: string;
  type: ColumnType;
  values: StoredValue[];
  unparseable: number;
  notes: string[];
}

const NULL_TOKENS = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', 'nil', '-', '--', '?', '#n/a', '#null!', '#value!', '#div/0!']);
const TRUE_TOKENS = new Set(['true', 'yes']);
const FALSE_TOKENS = new Set(['false', 'no']);
const ID_NAME = /(^|[_\s])(id|uuid|guid|key|code|sku|zip|zipcode|postcode|phone)$/i;

export function isMissing(v: Cell): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'number') return !Number.isFinite(v);
  if (v instanceof Date) return Number.isNaN(v.getTime());
  if (typeof v === 'boolean') return false;
  return NULL_TOKENS.has(v.trim().toLowerCase());
}

// ---------------------------------------------------------------- numbers

const PLAIN_NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
const THOUSANDS_COMMA = /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/;
const THOUSANDS_DOT = /^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/;
const CURRENCY_OR_SPACE = /[$€£¥₹\s  ]/g;

export interface NumberFormat { decimalComma: boolean; percent: boolean }

/** Decide once per column whether "1,5" means one-and-a-half. */
export function detectNumberFormat(samples: string[]): NumberFormat {
  let commaDecimal = 0, dotThousandsWithComma = 0, commaThousandsWithDot = 0, percent = 0;
  for (const raw of samples) {
    const s = raw.replace(CURRENCY_OR_SPACE, '');
    if (s.endsWith('%')) percent++;
    if (/^[-+]?\d+,(\d{1,2}|\d{4,})%?$/.test(s)) commaDecimal++;
    if (/\d\.\d{3},\d/.test(s)) dotThousandsWithComma++;
    if (/\d,\d{3}\.\d/.test(s)) commaThousandsWithDot++;
  }
  return {
    decimalComma: (commaDecimal > 0 || dotThousandsWithComma > 0) && commaThousandsWithDot === 0,
    percent: percent > 0 && percent >= samples.length * 0.9,
  };
}

export function parseNumber(raw: string, format: NumberFormat): number | null {
  let s = raw.trim();
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); } // accounting negatives
  s = s.replace(CURRENCY_OR_SPACE, '');
  if (s.endsWith('%')) s = s.slice(0, -1);
  if (format.decimalComma) {
    if (THOUSANDS_DOT.test(s)) s = s.replace(/\./g, '');
    s = s.replace(',', '.');
  } else if (THOUSANDS_COMMA.test(s)) {
    s = s.replace(/,/g, '');
  }
  if (!PLAIN_NUMBER.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// ---------------------------------------------------------------- dates

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i;
const YMD_SLASH = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/;
const YEAR_LAST = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const YEAR_MONTH = /^(\d{4})-(\d{2})$/;

export type DayOrder = 'mdy' | 'dmy';

const pad = (n: number) => String(n).padStart(2, '0');

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || y < 1000 || y > 9999) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function format(y: number, m: number, d: number, hh?: number, mm?: number, ss?: number): string {
  const date = `${y}-${pad(m)}-${pad(d)}`;
  if (hh === undefined || (hh === 0 && !mm && !ss)) return date;
  if (hh > 23 || (mm ?? 0) > 59 || (ss ?? 0) > 59) return date;
  return `${date} ${pad(hh)}:${pad(mm ?? 0)}:${pad(ss ?? 0)}`;
}

/** Looks at slash dates in a column to decide day/month order. */
export function detectDayOrder(samples: string[]): { order: DayOrder; ambiguous: boolean } {
  let firstOver12 = 0, secondOver12 = 0, matched = 0;
  for (const s of samples) {
    const m = YEAR_LAST.exec(s.trim());
    if (!m) continue;
    matched++;
    if (Number(m[1]) > 12) firstOver12++;
    if (Number(m[2]) > 12) secondOver12++;
  }
  if (firstOver12 && !secondOver12) return { order: 'dmy', ambiguous: false };
  if (secondOver12 && !firstOver12) return { order: 'mdy', ambiguous: false };
  return { order: 'mdy', ambiguous: matched > 0 && !firstOver12 && !secondOver12 };
}

/** Returns an ISO date (`YYYY-MM-DD`, optionally with ` HH:MM:SS`) or null. */
export function parseDate(raw: string, order: DayOrder): string | null {
  const s = raw.trim();
  let m = ISO_DATE.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!validDate(y, mo, d)) return null;
    if (m[7] && m[4] !== undefined) {
      // Timezone-qualified timestamps are normalised to UTC.
      const t = new Date(s.replace(' ', 'T'));
      if (Number.isNaN(t.getTime())) return null;
      return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds());
    }
    return format(y, mo, d, m[4] !== undefined ? Number(m[4]) : undefined, m[5] !== undefined ? Number(m[5]) : undefined, m[6] !== undefined ? Number(m[6]) : undefined);
  }
  m = YMD_SLASH.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validDate(y, mo, d) ? format(y, mo, d) : null;
  }
  m = YEAR_LAST.exec(s);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
    const [mo, d] = order === 'dmy' ? [b, a] : [a, b];
    if (!validDate(y, mo, d)) return null;
    return format(y, mo, d, m[4] !== undefined ? Number(m[4]) : undefined, m[5] !== undefined ? Number(m[5]) : undefined, m[6] !== undefined ? Number(m[6]) : undefined);
  }
  m = YEAR_MONTH.exec(s);
  if (m) {
    const [y, mo] = [Number(m[1]), Number(m[2])];
    return validDate(y, mo, 1) ? format(y, mo, 1) : null;
  }
  return null;
}

export function dateFromJs(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  return format(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
}

// ---------------------------------------------------------------- inference

/** Share of values that must parse for a column to take a stricter type. */
const PARSE_THRESHOLD = 0.98;

function passes(parsed: number, total: number): boolean {
  if (total === 0) return false;
  // Small columns must parse completely; large ones may contain a few stray values.
  return total < 50 ? parsed === total : parsed / total >= PARSE_THRESHOLD;
}

function textOf(v: Cell): string {
  if (v instanceof Date) return dateFromJs(v) ?? '';
  return String(v).trim();
}

export function normalizeColumn(name: string, originalName: string, cells: Cell[]): NormalizedColumn {
  const notes: string[] = [];
  const present: { index: number; value: Cell }[] = [];
  cells.forEach((value, index) => { if (!isMissing(value)) present.push({ index, value }); });
  const values: StoredValue[] = new Array(cells.length).fill(null);
  const done = (type: ColumnType, unparseable = 0): NormalizedColumn =>
    ({ name, original_name: originalName, type, values, unparseable, notes });

  if (!present.length) return done('text');

  const texts = present.map((p) => textOf(p.value));
  const sample = texts.slice(0, 5000);

  // Dates: native Date cells (Excel) or recognisable date strings.
  const dayOrder = detectDayOrder(sample);
  const dates = present.map((p) => p.value instanceof Date ? dateFromJs(p.value) : typeof p.value === 'string' ? parseDate(p.value, dayOrder.order) : null);
  const dateCount = dates.filter(Boolean).length;
  if (passes(dateCount, present.length)) {
    present.forEach((p, i) => { values[p.index] = dates[i]; });
    if (dayOrder.ambiguous) notes.push('Dates such as 03/04/2024 are ambiguous; they were read as month/day/year.');
    else if (dayOrder.order === 'dmy' && sample.some((s) => YEAR_LAST.test(s))) notes.push('Dates were read as day/month/year.');
    return done('date', present.length - dateCount);
  }

  // Leading zeros ("00123") mean a code, not a quantity.
  const hasLeadingZeros = texts.some((t) => /^0\d+$/.test(t));
  const numberFormat = detectNumberFormat(sample);
  const numbers = present.map((p) => typeof p.value === 'number' ? p.value : typeof p.value === 'boolean' ? null : parseNumber(textOf(p.value), numberFormat));
  const numberCount = numbers.filter((n) => n !== null).length;
  const distinctTexts = new Set(texts).size;
  const unique = distinctTexts / present.length;

  if (!hasLeadingZeros && passes(numberCount, present.length)) {
    const integers = numbers.every((n) => n === null || Number.isInteger(n));
    if (ID_NAME.test(name) && integers && unique > 0.9) {
      present.forEach((p, i) => { values[p.index] = texts[i]; });
      return done('identifier');
    }
    present.forEach((p, i) => { values[p.index] = numbers[i]; });
    if (numberFormat.decimalComma) notes.push('Commas were read as decimal separators (e.g. 1,5 = 1.5).');
    if (numberFormat.percent) notes.push('Values were written with a % sign; they are stored as the numbers shown (12% → 12).');
    return done('numeric', present.length - numberCount);
  }

  const lower = texts.map((t) => t.toLowerCase());
  if (lower.every((t) => TRUE_TOKENS.has(t) || FALSE_TOKENS.has(t)) || present.every((p) => typeof p.value === 'boolean')) {
    present.forEach((p, i) => { values[p.index] = typeof p.value === 'boolean' ? String(p.value) : texts[i]; });
    return done('boolean');
  }

  present.forEach((p, i) => { values[p.index] = texts[i]; });
  // A key column ("customer_id") repeats across rows but is still an identifier, not free text.
  if ((ID_NAME.test(name) && (unique > 0.9 || distinctTexts > 50)) || (hasLeadingZeros && unique > 0.9)) return done('identifier');
  if (distinctTexts <= 50 || unique <= 0.2) return done('categorical');
  return done('text');
}
