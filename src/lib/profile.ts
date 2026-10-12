import type { NormalizedColumn } from './ingest/values';
import { histogram, mean, quantileSorted, sortNumbers, std, sum } from './stats';
import type { ColumnProfile, QualityIssue, ValueCount } from './types';

/**
 * Profiles are computed once, at import, and cached with the dataset. Every
 * screen and every planner prompt reads them instead of rescanning the data.
 */
export function profileColumn(col: NormalizedColumn): ColumnProfile {
  const total = col.values.length;
  const present = col.values.filter((v): v is string | number => v !== null);
  const counts = new Map<string, number>();
  for (const v of present) {
    const key = String(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const topValues: ValueCount[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([value, count]) => ({ value, count }));

  let numeric: ColumnProfile['numeric'] = null;
  if (col.type === 'numeric' && present.length) {
    const sorted = sortNumbers(present as number[]);
    const p25 = quantileSorted(sorted, 0.25), p75 = quantileSorted(sorted, 0.75);
    const iqr = p75 - p25;
    const lo = p25 - 1.5 * iqr, hi = p75 + 1.5 * iqr;
    numeric = {
      min: sorted[0], max: sorted[sorted.length - 1],
      mean: mean(sorted), median: quantileSorted(sorted, 0.5), std: std(sorted),
      p25, p75, sum: sum(sorted),
      zeros: sorted.filter((x) => x === 0).length,
      negatives: sorted.filter((x) => x < 0).length,
      outliers: iqr > 0 ? sorted.filter((x) => x < lo || x > hi).length : 0,
      histogram: histogram(sorted),
    };
  }

  let date: ColumnProfile['date'] = null;
  if (col.type === 'date' && present.length) {
    const days = (present as string[]).map((d) => d.slice(0, 10)).sort();
    const monthly = new Map<string, number>();
    for (const d of days) monthly.set(d.slice(0, 7), (monthly.get(d.slice(0, 7)) ?? 0) + 1);
    date = {
      min: days[0], max: days[days.length - 1], months: monthly.size,
      monthly: [...monthly.entries()].map(([value, count]) => ({ value, count })),
    };
  }

  // Spellings that collapse to the same value once case and spacing are ignored.
  const variants: string[][] = [];
  if (col.type === 'categorical' || col.type === 'text' || col.type === 'boolean') {
    const groups = new Map<string, string[]>();
    for (const key of counts.keys()) {
      const norm = key.toLowerCase().replace(/\s+/g, ' ').trim();
      groups.set(norm, [...(groups.get(norm) ?? []), key]);
    }
    for (const g of groups.values()) if (g.length > 1 && variants.length < 5) variants.push(g.slice(0, 4));
  }

  const missing = total - present.length;
  return {
    name: col.name,
    original_name: col.original_name,
    type: col.type,
    missing,
    missing_pct: total ? (missing / total) * 100 : 0,
    distinct: counts.size,
    unparseable: col.unparseable,
    samples: [...counts.keys()].slice(0, 5),
    top_values: col.type === 'numeric' ? topValues.slice(0, 5) : topValues,
    numeric,
    date,
    notes: col.notes,
    variants,
  };
}

/** Count of rows that exactly repeat an earlier row. */
export function countDuplicateRows(columns: NormalizedColumn[], rowCount: number): number {
  const seen = new Set<string>();
  let dupes = 0;
  for (let r = 0; r < rowCount; r++) {
    const key = JSON.stringify(columns.map((c) => c.values[r]));
    if (seen.has(key)) dupes++; else seen.add(key);
  }
  return dupes;
}

const EXPECT_NON_NEGATIVE = /revenue|price|units|qty|quantity|amount|cost|sales|count|age|weight|height|duration/i;

/** Data-quality findings. Read-only: the stored dataset is never modified to "fix" them. */
export function qualityIssues(profiles: ColumnProfile[], rowCount: number, duplicateRows: number): QualityIssue[] {
  const issues: QualityIssue[] = [];
  if (duplicateRows) {
    issues.push({ kind: 'duplicates', severity: 'warning', column: null,
      message: `${duplicateRows.toLocaleString()} row${duplicateRows > 1 ? 's are exact duplicates' : ' is an exact duplicate'} of an earlier row. Duplicates are kept; totals include them.` });
  }
  for (const p of profiles) {
    if (p.missing === rowCount) {
      issues.push({ kind: 'empty_column', severity: 'warning', column: p.name, message: `${p.name} is completely empty.` });
      continue;
    }
    if (p.missing_pct >= 1 || (p.missing > 0 && rowCount < 100)) {
      issues.push({ kind: 'missing', severity: p.missing_pct >= 20 ? 'warning' : 'info', column: p.name,
        message: `${p.name} is missing ${p.missing.toLocaleString()} value${p.missing > 1 ? 's' : ''} (${p.missing_pct.toFixed(1)}%). Missing values are excluded from sums and averages.` });
    }
    if (p.unparseable) {
      issues.push({ kind: 'unparseable', severity: 'warning', column: p.name,
        message: `${p.unparseable.toLocaleString()} value${p.unparseable > 1 ? 's' : ''} in ${p.name} could not be read as ${p.type === 'date' ? 'dates' : 'numbers'} and ${p.unparseable > 1 ? 'are' : 'is'} treated as missing.` });
    }
    if (p.variants.length && p.type !== 'boolean') {
      const examples = p.variants.slice(0, 2).map((g) => g.map((v) => `"${v}"`).join(' / ')).join('; ');
      issues.push({ kind: 'inconsistent_values', severity: 'warning', column: p.name,
        message: `${p.name} has values that differ only in capitalisation or spacing (${examples}). They are counted as separate groups.` });
    }
    if (p.distinct === 1 && rowCount > 1) {
      issues.push({ kind: 'constant', severity: 'info', column: p.name, message: `${p.name} has the same value in every row, so it cannot explain differences.` });
    }
    if (p.type === 'categorical' && p.distinct > 100) {
      issues.push({ kind: 'high_cardinality', severity: 'info', column: p.name, message: `${p.name} has ${p.distinct.toLocaleString()} distinct values; grouped charts will show only the largest groups.` });
    }
    if (p.numeric && p.numeric.negatives > 0 && EXPECT_NON_NEGATIVE.test(p.name)) {
      issues.push({ kind: 'negative', severity: 'warning', column: p.name,
        message: `${p.name} has ${p.numeric.negatives.toLocaleString()} negative value${p.numeric.negatives > 1 ? 's' : ''}, which is unusual for a field with this name (returns or data-entry errors?).` });
    }
    if (p.numeric && p.numeric.outliers > 0) {
      const share = (p.numeric.outliers / (rowCount - p.missing)) * 100;
      if (share >= 0.5) {
        issues.push({ kind: 'outliers', severity: 'info', column: p.name,
          message: `${p.name} has ${p.numeric.outliers.toLocaleString()} value${p.numeric.outliers > 1 ? 's' : ''} (${share.toFixed(1)}%) far outside the typical range (1.5 × IQR). Averages may be skewed; medians are more robust.` });
      }
    }
  }
  const order = { warning: 0, info: 1 } as const;
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}
