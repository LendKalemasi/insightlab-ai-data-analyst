import type { ColumnProfile } from '../types';

/** Column-name hints for "the main metric", strongest first. */
const HINTS = [/revenue|sales|turnover/i, /profit|margin|income/i, /amount|total|value|price|spend|cost/i, /quantity|units|count|qty/i];

/** Picks the numeric column a question most likely means when it names none. */
export function primaryMetric(columns: ColumnProfile[]): ColumnProfile | undefined {
  const numeric = columns.filter((c) => c.type === 'numeric');
  for (const hint of HINTS) {
    const hit = numeric.find((c) => hint.test(c.name));
    if (hit) return hit;
  }
  return numeric[0];
}
