import type { ColumnKind, ColumnProfile } from './types';

const NUM_CLEAN = /[$€£,%\s]/g;
export const isNumeric = (v: unknown): boolean => {
  if (v === null || v === undefined || v === '') return false;
  const s = String(v).replace(NUM_CLEAN, '');
  return s !== '' && Number.isFinite(Number(s));
};
export const toNumber = (v: unknown): number => Number(String(v).replace(NUM_CLEAN, ''));
export const isDateLike = (v: unknown): boolean =>
  /^\d{4}-\d{2}-\d{2}([ T]|$)/.test(String(v)) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(v));

export function inferKind(name: string, values: string[], uniqueCount: number): ColumnKind {
  if (!values.length) return 'text';
  if (values.every(isDateLike)) return 'date';
  const idName = /(^|_)(id|uuid|key|code)$/i.test(name);
  if (values.every(isNumeric)) {
    return idName && uniqueCount > values.length * 0.9 ? 'identifier' : 'numeric';
  }
  if (idName && uniqueCount > values.length * 0.9) return 'identifier';
  if (uniqueCount <= Math.max(20, values.length * 0.05)) return 'categorical';
  return 'text';
}

export function profileColumns(
  columns: string[], rows: Record<string, unknown>[],
): ColumnProfile[] {
  return columns.map((name) => {
    const all = rows.map((r) => r[name]);
    const present = all.filter((v) => v !== '' && v !== null && v !== undefined).map(String);
    const nullCount = all.length - present.length;
    const unique = new Set(present).size;
    const kind = inferKind(name, present, unique);

    let min: number | string | null = null, max: number | string | null = null, mean: number | null = null;
    if (kind === 'numeric' && present.length) {
      const nums = present.map(toNumber);
      min = Math.min(...nums); max = Math.max(...nums);
      mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    } else if (kind === 'date' && present.length) {
      const sorted = [...present].sort();
      min = sorted[0]; max = sorted[sorted.length - 1];
    }
    return {
      column_name: name, inferred_type: kind, null_count: nullCount,
      null_percentage: all.length ? (nullCount / all.length) * 100 : 0,
      unique_count: unique, sample_values: [...new Set(present)].slice(0, 3),
      statistics: { min, max, mean },
    };
  });
}

/** Data-quality findings. Read-only: the raw dataset is never mutated. */
export function qualityWarnings(
  profiles: ColumnProfile[], rows: Record<string, unknown>[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let dupes = 0;
  for (const r of rows) {
    const k = JSON.stringify(r);
    if (seen.has(k)) dupes++; else seen.add(k);
  }
  if (dupes) out.push(`${dupes} duplicate row(s) detected. They are retained in the raw dataset, not removed.`);
  for (const p of profiles.filter((x) => x.null_percentage > 0).sort((a, b) => b.null_percentage - a.null_percentage).slice(0, 5)) {
    out.push(`${p.column_name}: ${p.null_count} missing value(s) (${p.null_percentage.toFixed(1)}%).`);
  }
  for (const p of profiles) {
    if (p.unique_count === 1) out.push(`${p.column_name} is constant — it has a single distinct value.`);
    if (p.inferred_type === 'categorical' && p.unique_count > 30) out.push(`${p.column_name} has high cardinality (${p.unique_count} levels).`);
    if (p.inferred_type === 'numeric' && typeof p.statistics.min === 'number' && p.statistics.min < 0
      && /revenue|price|units|qty|quantity|amount|cost/i.test(p.column_name)) {
      out.push(`${p.column_name} contains negative values, which is unexpected for this field name.`);
    }
  }
  if (!rows.length) out.push('The dataset contains no rows.');
  return out;
}
