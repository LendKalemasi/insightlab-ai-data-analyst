import { primaryMetric } from '@/lib/analysis/metric';
import type { DatasetInfo } from '@/lib/types';

/** Starter questions built from the dataset's real columns, so every suggestion is answerable. */
export function buildSuggestions(info: DatasetInfo): string[] {
  const numeric = info.columns.filter((c) => c.type === 'numeric');
  const metric = primaryMetric(info.columns);
  const dims = info.columns.filter((c) => c.type === 'categorical' && c.distinct > 1 && c.distinct <= 60);
  const date = info.columns.find((c) => c.type === 'date');
  const out: string[] = [];
  if (metric && date) out.push(`How has ${metric.name} changed over time?`);
  if (metric && dims[0]) out.push(`Which ${dims[0].name} has the highest ${metric.name}?`);
  if (metric && dims[1]) out.push(`Compare average ${metric.name} by ${dims[1].name}`);
  if (metric) out.push(`What is the distribution of ${metric.name}?`);
  if (numeric.length > 1) out.push('What are the strongest correlations between numeric columns?');
  if (metric) out.push(`Are there any outliers in ${metric.name}?`);
  if (info.missing_cells > 0 || info.duplicate_rows > 0) out.push('Which columns have the most missing data?');
  if (!out.length && dims[0]) out.push(`How many rows are there per ${dims[0].name}?`);
  return out.slice(0, 6);
}
