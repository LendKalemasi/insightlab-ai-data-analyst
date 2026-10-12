'use client';
import { AlertTriangle, ArrowRight, ChevronRight, Info, MessageSquareText } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { formatInteger, formatPercent, formatStat } from '@/lib/format';
import type { ColumnProfile } from '@/lib/types';
import { buildSuggestions } from '../analysis/suggestions';
import { Alert, cx } from '../ui';
import { ColumnSheet } from './column-sheet';
import { MiniDistribution, MissingBar, TypeBadge } from './column-meta';
import { useDataset } from './context';

export function OverviewView() {
  const { info, id, setDraft } = useDataset();
  const router = useRouter();
  const [selected, setSelected] = useState<ColumnProfile | null>(null);
  const suggestions = useMemo(() => buildSuggestions(info), [info]);
  const totalCells = info.row_count * info.column_count;
  const columnNotes = info.columns.flatMap((c) => c.notes.map((n) => `${c.name}: ${n}`));
  const notes = [...info.ingest_notes, ...columnNotes];

  const askAbout = (q: string) => { setDraft(q); router.push(`/datasets/${id}/ask`); };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <section aria-label="Dataset summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Rows" value={formatInteger(info.row_count)} />
        <Stat label="Columns" value={String(info.column_count)} detail={typeBreakdown(info.columns)} />
        <Stat label="Missing cells" value={formatInteger(info.missing_cells)} detail={`${formatPercent((info.missing_cells / Math.max(1, totalCells)) * 100, 2)} of all cells`} tone={info.missing_cells ? 'warning' : 'success'} />
        <Stat label="Duplicate rows" value={formatInteger(info.duplicate_rows)} detail={info.duplicate_rows ? 'Kept in all calculations' : 'None found'} tone={info.duplicate_rows ? 'warning' : 'success'} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="card min-w-0" aria-labelledby="columns-heading">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 id="columns-heading" className="font-semibold">Columns</h2>
            <p className="text-xs text-muted">Select a column for details</p>
          </div>
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th scope="col" className="px-4 py-2 font-medium">Name</th>
                  <th scope="col" className="px-2 py-2 font-medium">Type</th>
                  <th scope="col" className="px-2 py-2 font-medium">Missing</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Distinct</th>
                  <th scope="col" className="px-2 py-2 font-medium">Summary</th>
                  <th scope="col" className="px-4 py-2 font-medium"><span className="sr-only">Distribution</span></th>
                </tr>
              </thead>
              <tbody>
                {info.columns.map((c) => (
                  <tr key={c.name} className="group cursor-pointer border-b border-line last:border-0 hover:bg-sunken/60" onClick={() => setSelected(c)}>
                    <td className="max-w-[220px] px-4 py-2.5">
                      <button type="button" className="block max-w-full truncate rounded text-left font-medium group-hover:text-primary" onClick={(e) => { e.stopPropagation(); setSelected(c); }}>
                        {c.name}
                      </button>
                      {c.original_name !== c.name && <span className="block truncate text-2xs text-muted">from “{c.original_name}”</span>}
                    </td>
                    <td className="px-2 py-2.5"><TypeBadge type={c.type} /></td>
                    <td className="px-2 py-2.5"><MissingBar pct={c.missing_pct} /></td>
                    <td className="num px-2 py-2.5 text-right text-muted">{formatInteger(c.distinct)}</td>
                    <td className="max-w-[240px] truncate px-2 py-2.5 text-xs text-muted">{columnSummary(c, info.row_count)}</td>
                    <td className="px-4 py-2.5"><MiniDistribution column={c} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="space-y-6">
          <section className="card" aria-labelledby="quality-heading">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 id="quality-heading" className="font-semibold">Data quality</h2>
              <span className="text-xs text-muted">{info.quality.length ? `${info.quality.length} finding${info.quality.length > 1 ? 's' : ''}` : 'No issues'}</span>
            </div>
            {info.quality.length ? (
              <ul className="max-h-[360px] divide-y divide-line overflow-y-auto scroll-thin">
                {info.quality.map((q, i) => (
                  <li key={i} className="flex gap-2.5 px-4 py-3 text-sm">
                    {q.severity === 'warning'
                      ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-label="Warning" />
                      : <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-label="Note" />}
                    <div className="min-w-0">
                      <p>{q.message}</p>
                      {q.column && q.kind === 'missing' && (
                        <Link href={`/datasets/${id}/data?missing=${encodeURIComponent(q.column)}`} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                          Show rows with missing {q.column} <ChevronRight className="h-3 w-3" aria-hidden />
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-4 text-sm text-muted">No missing values, duplicates, constant columns or suspicious values were found.</p>
            )}
          </section>

          <section className="card p-4" aria-labelledby="ask-heading">
            <h2 id="ask-heading" className="flex items-center gap-2 font-semibold"><MessageSquareText className="h-4 w-4 text-primary" aria-hidden />Ask a question</h2>
            <ul className="mt-3 space-y-1.5">
              {suggestions.slice(0, 4).map((s) => (
                <li key={s}>
                  <button type="button" onClick={() => askAbout(s)} className="flex w-full items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-left text-sm hover:border-primary/40 hover:bg-primary-soft">
                    <span>{s}</span><ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {notes.length > 0 && (
        <Alert tone="info" title="How this file was read">
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </Alert>
      )}

      <ColumnSheet column={selected} onClose={() => setSelected(null)} rowCount={info.row_count}
        onAsk={(q) => { setSelected(null); askAbout(q); }}
        onBrowse={(c) => router.push(`/datasets/${id}/data?sort=${encodeURIComponent(c)}&dir=desc`)} />
    </div>
  );
}

function Stat({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: 'warning' | 'success' }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={cx('mt-1 text-2xl font-semibold tracking-tight num', tone === 'warning' && value !== '0' && 'text-warning')}>{value}</p>
      {detail && <p className="mt-0.5 truncate text-xs text-muted">{detail}</p>}
    </div>
  );
}

function typeBreakdown(cols: ColumnProfile[]): string {
  const counts = new Map<string, number>();
  for (const c of cols) counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
  const label: Record<string, string> = { numeric: 'numeric', date: 'date', categorical: 'category', boolean: 'yes/no', identifier: 'ID', text: 'text' };
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n} ${label[t]}`).join(' · ');
}

export function columnSummary(c: ColumnProfile, rows: number): string {
  if (c.missing === rows) return 'Empty';
  if (c.numeric) return `${formatStat(c.numeric.min)} – ${formatStat(c.numeric.max)} · mean ${formatStat(c.numeric.mean)}`;
  if (c.date) return `${c.date.min} → ${c.date.max}`;
  const top = c.top_values[0];
  if (c.type === 'identifier' || c.type === 'text') return `${formatInteger(c.distinct)} distinct · e.g. ${c.samples[0] ?? '—'}`;
  return top ? `Most common: ${top.value} (${formatPercent((top.count / (rows - c.missing)) * 100)})` : '—';
}
