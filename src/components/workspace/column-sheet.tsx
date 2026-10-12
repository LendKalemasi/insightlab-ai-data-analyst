'use client';
import { ArrowDownWideNarrow, MessageSquareText } from 'lucide-react';
import { formatInteger, formatNumber, formatPercent, formatStat } from '@/lib/format';
import type { ChartSpec, ColumnProfile } from '@/lib/types';
import { ChartView } from '../charts/chart-view';
import { Button, Dialog } from '../ui';
import { TypeBadge } from './column-meta';

/** Builds a chart from the cached profile — no query needed. */
function profileChart(c: ColumnProfile): ChartSpec | null {
  if (c.numeric && c.numeric.histogram.length > 1) {
    return {
      type: 'histogram', title: `Distribution of ${c.name}`, description: `Histogram of ${c.name}.`,
      x: { key: 'label', label: c.name, kind: 'number' }, y: { label: 'Rows', format: 'integer' },
      series: [{ key: 's0', label: 'Rows' }], note: null,
      data: c.numeric.histogram.map((b) => ({ label: `${formatNumber(b.start)}–${formatNumber(b.end)}`, s0: b.count })),
    };
  }
  if (c.date && c.date.monthly.length > 1) {
    return {
      type: c.date.monthly.length > 3 ? 'line' : 'bar', title: `Rows per month`, description: `Rows per month of ${c.name}.`,
      x: { key: 'label', label: 'Month', kind: 'time' }, y: { label: 'Rows', format: 'integer' },
      series: [{ key: 's0', label: 'Rows' }], note: null,
      data: c.date.monthly.map((m) => ({ label: m.value, s0: m.count })),
    };
  }
  if (c.top_values.length > 1 && c.type !== 'identifier') {
    return {
      type: 'hbar', title: 'Most common values', description: `Most common values of ${c.name}.`,
      x: { key: 'label', label: c.name, kind: 'category' }, y: { label: 'Rows', format: 'integer' },
      series: [{ key: 's0', label: 'Rows' }], note: null,
      data: c.top_values.map((v) => ({ label: v.value, s0: v.count })),
    };
  }
  return null;
}

export function ColumnSheet({ column, onClose, rowCount, onAsk, onBrowse }: {
  column: ColumnProfile | null; onClose: () => void; rowCount: number; onAsk: (q: string) => void; onBrowse: (column: string) => void;
}) {
  const c = column;
  const chart = c ? profileChart(c) : null;
  const present = c ? rowCount - c.missing : 0;
  const question = !c ? '' : c.type === 'numeric' ? `What is the distribution of ${c.name}?`
    : c.type === 'date' ? `How many rows are there per month of ${c.name}?`
      : `What is the distribution of ${c.name}?`;

  return (
    <Dialog side open={!!c} onClose={onClose}
      title={c?.name ?? ''}
      description={c && <span className="flex flex-wrap items-center gap-2"><TypeBadge type={c.type} />{c.original_name !== c.name && <span>Header in file: “{c.original_name}”</span>}</span>}
      footer={c && (
        <>
          <Button size="sm" onClick={() => onBrowse(c.name)} icon={<ArrowDownWideNarrow className="h-4 w-4" aria-hidden />}>Sort rows by this</Button>
          <Button size="sm" variant="primary" onClick={() => onAsk(question)} icon={<MessageSquareText className="h-4 w-4" aria-hidden />}>Ask about it</Button>
        </>
      )}>
      {c && (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Metric label="Values present" value={formatInteger(present)} />
            <Metric label="Missing" value={`${formatInteger(c.missing)} (${formatPercent(c.missing_pct)})`} warn={c.missing_pct >= 20} />
            <Metric label="Distinct" value={formatInteger(c.distinct)} />
            {c.unparseable > 0 && <Metric label="Unreadable values" value={formatInteger(c.unparseable)} warn />}
            {c.numeric && (
              <>
                <Metric label="Mean" value={formatStat(c.numeric.mean)} />
                <Metric label="Median" value={formatStat(c.numeric.median)} />
                <Metric label="Std. deviation" value={formatStat(c.numeric.std)} />
                <Metric label="Minimum" value={formatStat(c.numeric.min)} />
                <Metric label="25th–75th pct." value={`${formatStat(c.numeric.p25)} – ${formatStat(c.numeric.p75)}`} />
                <Metric label="Maximum" value={formatStat(c.numeric.max)} />
                <Metric label="Sum" value={formatStat(c.numeric.sum)} />
                <Metric label="Outliers (1.5×IQR)" value={formatInteger(c.numeric.outliers)} />
                <Metric label="Negative / zero" value={`${formatInteger(c.numeric.negatives)} / ${formatInteger(c.numeric.zeros)}`} />
              </>
            )}
            {c.date && (
              <>
                <Metric label="Earliest" value={c.date.min} />
                <Metric label="Latest" value={c.date.max} />
                <Metric label="Months covered" value={String(c.date.months)} />
              </>
            )}
          </dl>

          {chart && (
            <section aria-label={chart.title}>
              <h3 className="mb-2 text-sm font-medium">{chart.title}</h3>
              <ChartView spec={chart} height={220} compact />
            </section>
          )}

          {(c.type === 'identifier' || c.type === 'text') && c.samples.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-medium">Example values</h3>
              <ul className="flex flex-wrap gap-1.5">{c.samples.map((s) => <li key={s} className="max-w-full truncate rounded border border-line bg-sunken px-2 py-0.5 text-xs">{s}</li>)}</ul>
            </section>
          )}

          {c.notes.length > 0 && (
            <section>
              <h3 className="mb-1 text-sm font-medium">Parsing notes</h3>
              <ul className="list-disc space-y-0.5 pl-4 text-sm text-muted">{c.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </section>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-md border border-line px-3 py-2">
      <dt className="text-2xs font-medium text-muted">{label}</dt>
      <dd className={`mt-0.5 truncate text-sm font-semibold num ${warn ? 'text-warning' : ''}`} title={value}>{value}</dd>
    </div>
  );
}
