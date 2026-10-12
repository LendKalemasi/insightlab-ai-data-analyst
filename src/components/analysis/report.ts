import type { AnalysisTurn, DatasetInfo } from '@/lib/types';

/** A Markdown record of the session that keeps AI text, calculated values and caveats clearly labelled. */
export function buildReport(info: DatasetInfo, turns: AnalysisTurn[]): string {
  const lines = [
    `# Analysis report — ${info.name}`,
    '',
    `Dataset: ${info.row_count.toLocaleString('en-US')} rows × ${info.column_count} columns · exported ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    '',
    'Calculated values come from read-only SQL and deterministic statistics. Sections marked *AI interpretation* were written by a language model from those values.',
  ];
  turns.forEach((t, i) => {
    lines.push('', `## ${i + 1}. ${t.question}`, '');
    if (t.status === 'clarification') { lines.push(`*Clarification requested:* ${t.clarification?.question ?? ''}`); return; }
    if (t.status === 'unsupported') { lines.push(`*Not answerable from this dataset:* ${t.interpretation}`); return; }
    if (t.status === 'error') { lines.push(`*Failed:* ${t.error?.message ?? 'unknown error'}`); return; }
    if (t.narrative) {
      lines.push('**AI interpretation**', '', `> **${t.narrative.headline}**`, '>', `> ${t.narrative.summary}`);
      t.narrative.insights.forEach((ins) => lines.push(`> - ${ins.text}`));
      if (t.grounding?.unverified.length) lines.push('>', `> ⚠ Figures not matched to calculated results: ${t.grounding.unverified.join(', ')}`);
      lines.push('');
    }
    lines.push('**Calculated result**', '', t.computed_summary, '');
    if (t.facts.length) {
      lines.push('| Measure | Value | Detail |', '|---|---|---|');
      t.facts.forEach((f) => lines.push(`| ${f.label} | ${f.display} | ${f.detail ?? ''} |`));
      lines.push('');
    }
    const caveats = [...t.warnings, ...(t.narrative?.caveats ?? [])];
    if (caveats.length) { lines.push('**Caveats**', ''); caveats.forEach((c) => lines.push(`- ${c}`)); lines.push(''); }
    if (t.assumptions.length) { lines.push('**Assumptions**', ''); t.assumptions.forEach((a) => lines.push(`- ${a}`)); lines.push(''); }
    if (t.sql) lines.push('<details><summary>SQL</summary>', '', '```sql', t.sql, '```', '', '</details>');
  });
  return lines.join('\n') + '\n';
}
