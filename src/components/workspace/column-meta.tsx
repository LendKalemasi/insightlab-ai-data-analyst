'use client';
import { Calendar, Hash, KeyRound, Tags, ToggleLeft, Type } from 'lucide-react';
import type { ColumnProfile, ColumnType } from '@/lib/types';
import { cx } from '../ui';

const TYPE_META: Record<ColumnType, { label: string; icon: typeof Hash; hint: string }> = {
  numeric: { label: 'Number', icon: Hash, hint: 'Numeric values; can be summed and averaged.' },
  date: { label: 'Date', icon: Calendar, hint: 'Dates normalised to YYYY-MM-DD; can be grouped by day, week, month, quarter or year.' },
  categorical: { label: 'Category', icon: Tags, hint: 'A limited set of repeated values; good for grouping.' },
  boolean: { label: 'Yes/No', icon: ToggleLeft, hint: 'Two values such as true/false or yes/no.' },
  identifier: { label: 'ID', icon: KeyRound, hint: 'Mostly unique codes; useful for counting distinct records, not for arithmetic.' },
  text: { label: 'Text', icon: Type, hint: 'Free text with many distinct values.' },
};

export function TypeBadge({ type, className }: { type: ColumnType; className?: string }) {
  const meta = TYPE_META[type];
  const Icon = meta.icon;
  return (
    <span title={meta.hint} className={cx('inline-flex items-center gap-1 rounded border border-line bg-sunken px-1.5 py-px text-2xs font-medium text-muted', className)}>
      <Icon className="h-3 w-3" aria-hidden />{meta.label}
    </span>
  );
}

export const typeIcon = (type: ColumnType) => TYPE_META[type].icon;

/** Tiny inline histogram or top-value bars for the column table. Decorative: values are in the adjacent text. */
export function MiniDistribution({ column }: { column: ColumnProfile }) {
  const W = 96, H = 24;
  const bins = column.numeric?.histogram.map((b) => b.count)
    ?? column.date?.monthly.slice(-24).map((m) => m.count)
    ?? column.top_values.slice(0, 6).map((v) => v.count);
  if (!bins.length) return <span className="text-xs text-subtle">—</span>;
  const max = Math.max(...bins, 1);
  const w = W / bins.length;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="block">
      {bins.map((v, i) => {
        const h = Math.max(1, (v / max) * H);
        return <rect key={i} x={i * w + 0.5} y={H - h} width={Math.max(1, w - 1.5)} height={h} rx={1} fill="var(--series-1)" opacity={0.85} />;
      })}
    </svg>
  );
}

export function MissingBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-line" aria-hidden>
        {pct > 0 && <div className={cx('h-full rounded-full', pct >= 20 ? 'bg-warning' : 'bg-muted')} style={{ width: `${Math.max(4, pct)}%` }} />}
      </div>
      <span className={cx('num text-xs', pct >= 20 ? 'font-medium text-warning' : 'text-muted')}>{pct === 0 ? '0%' : pct < 0.1 ? '<0.1%' : `${pct.toFixed(1)}%`}</span>
    </div>
  );
}
