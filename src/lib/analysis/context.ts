import { formatNumber, formatPercent } from '../format';
import type { AnalysisTurn, DatasetInfo } from '../types';

/**
 * What the language model is told about a dataset: column names, types,
 * summary statistics and, for low-cardinality columns, their most common
 * values (so filters can use real spellings). Raw rows are never sent.
 */
const clip = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function describeDataset(info: DatasetInfo): string {
  const lines = [`Dataset "${clip(info.name, 80)}": ${info.row_count} rows, ${info.column_count} columns.`, 'Columns:'];
  for (const c of info.columns) {
    const parts = [`- ${c.name} (${c.type}${c.type === 'categorical' || c.type === 'boolean' ? `, ${c.distinct} distinct` : ''})`];
    if (c.numeric) parts.push(`min ${formatNumber(c.numeric.min)}, max ${formatNumber(c.numeric.max)}, mean ${formatNumber(c.numeric.mean)}`);
    if (c.date) parts.push(`${c.date.min} to ${c.date.max}`);
    if ((c.type === 'categorical' || c.type === 'boolean') && c.top_values.length) {
      parts.push(`values: ${c.top_values.map((v) => `${JSON.stringify(clip(v.value))} (${v.count})`).join(', ')}${c.distinct > c.top_values.length ? ', …' : ''}`);
    }
    if (c.type === 'text' || c.type === 'identifier') parts.push(`${c.distinct} distinct, e.g. ${c.samples.slice(0, 2).map((s) => JSON.stringify(clip(s, 24))).join(', ')}`);
    if (c.missing) parts.push(`${formatPercent(c.missing_pct)} missing`);
    if (c.original_name !== c.name) parts.push(`originally "${clip(c.original_name)}"`);
    lines.push(parts.join('; '));
  }
  return lines.join('\n');
}

/** Earlier turns, summarised for follow-up questions ("same but by region"). */
export function historyMessages(turns: AnalysisTurn[]): { role: 'user' | 'assistant'; content: string }[] {
  return turns.slice(-6).flatMap((t) => [
    { role: 'user' as const, content: t.question },
    {
      role: 'assistant' as const,
      content: t.status === 'answered'
        ? `Interpreted as: ${t.interpretation}\nSpec: ${JSON.stringify(t.spec)}\nComputed: ${t.computed_summary}`
        : t.status === 'clarification' ? `Asked for clarification: ${t.clarification?.question ?? ''}`
          : `Could not answer: ${t.interpretation || t.error?.message || ''}`,
    },
  ]);
}
