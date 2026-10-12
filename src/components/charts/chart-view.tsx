'use client';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import { formatCompact, formatInteger, formatNumber, formatPercent } from '@/lib/format';
import type { ChartSpec, ValueFormat } from '@/lib/types';

/**
 * Renders a server-built ChartSpec. Bars and areas always start at zero so
 * lengths stay honest; lines may zoom to the data range. Series colours come
 * from the validated palette tokens, in fixed order, so a series keeps its
 * colour across charts.
 */
const seriesColor = (i: number) => `var(--series-${(i % 8) + 1})`;
/** Catch-all series ("Other", missing values) are neutral grey so they never compete with real groups. */
export const isNeutralSeries = (label: string) => label === 'Other' || label === '(missing)';
const AXIS = { stroke: 'var(--chart-axis)', tick: { fill: 'var(--chart-text)', fontSize: 11 }, tickLine: false } as const;

export function formatFor(format: ValueFormat, compact = false) {
  return (v: unknown) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v ?? '—');
    if (format === 'percent') return formatPercent(n);
    if (format === 'correlation') return n.toFixed(2);
    if (format === 'integer') return compact && Math.abs(n) >= 10_000 ? formatCompact(n) : formatInteger(n);
    return compact && Math.abs(n) >= 10_000 ? formatCompact(n) : formatNumber(n);
  };
}

interface TooltipPayload { name?: string; value?: unknown; color?: string; dataKey?: string | number; payload?: Record<string, unknown> }

function ChartTooltip({ active, payload, label, spec }: { active?: boolean; payload?: TooltipPayload[]; label?: unknown; spec: ChartSpec }) {
  if (!active || !payload?.length) return null;
  const fmt = formatFor(spec.y.format);
  const title = spec.type === 'scatter' ? null : String(label ?? '');
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      {title && <p className="mb-1 font-medium text-fg">{title}</p>}
      {spec.type === 'scatter' && payload[0]?.payload ? (
        <div className="space-y-0.5 text-muted">
          <p><span className="text-fg num">{formatNumber(Number(payload[0].payload.x))}</span> {spec.x.label}</p>
          <p><span className="text-fg num">{formatNumber(Number(payload[0].payload.y))}</span> {spec.y.label}</p>
          {spec.series.length > 1 && <p>{spec.series.find((s) => s.key === payload[0].payload!.series)?.label}</p>}
        </div>
      ) : payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: p.color }} aria-hidden />
          <span className="text-muted">{spec.series.find((s) => s.key === p.dataKey)?.label ?? p.name}</span>
          <span className="ml-auto pl-3 font-medium text-fg num">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ spec }: { spec: ChartSpec }) {
  if (spec.series.length < 2) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
      {spec.series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: isNeutralSeries(s.label) ? 'var(--chart-text)' : seriesColor(i) }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function ChartView({ spec, height = 300, compact = false }: { spec: ChartSpec; height?: number; compact?: boolean }) {
  if (spec.type === 'heatmap') return <Heatmap spec={spec} />;
  const tooltip = <Tooltip content={<ChartTooltip spec={spec} />} cursor={{ fill: 'rgb(var(--sunken))', stroke: 'var(--chart-axis)' }} isAnimationActive={false} />;
  const yFmt = formatFor(spec.y.format, true);
  const colorOf = (i: number) => (isNeutralSeries(spec.series[i]?.label ?? '') ? 'var(--chart-text)' : seriesColor(i));
  const margin = { top: 8, right: 12, bottom: compact ? 0 : 4, left: 0 };

  if (spec.type === 'hbar') {
    const longest = Math.max(...spec.data.map((d) => String(d.label).length));
    const labelWidth = Math.min(160, Math.max(60, longest * 6.5));
    const h = Math.max(compact ? 160 : 220, spec.data.length * 26 + 40);
    return (
      <ResponsiveContainer width="100%" height={h}>
        <BarChart data={spec.data} layout="vertical" margin={{ ...margin, right: 24 }} barCategoryGap={4}>
          <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
          <XAxis type="number" {...AXIS} tickFormatter={yFmt} domain={[(min: number) => Math.min(0, min), 'auto']} />
          <YAxis type="category" dataKey="label" {...AXIS} width={labelWidth} interval={0} tickFormatter={(v) => truncate(String(v), Math.floor(labelWidth / 6.5))} />
          {tooltip}
          {spec.series.map((s, i) => <Bar key={s.key} dataKey={s.key} fill={colorOf(i)} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false} />)}
          <ReferenceLine x={0} stroke="var(--chart-axis)" />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (spec.type === 'bar' || spec.type === 'histogram') {
    const histogram = spec.type === 'histogram';
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={spec.data} margin={margin} barCategoryGap={histogram ? 1 : '20%'}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={histogram ? 24 : 8} tickFormatter={(v) => truncate(String(v), 14)} />
          <YAxis {...AXIS} axisLine={false} width={52} tickFormatter={yFmt} domain={[(min: number) => Math.min(0, min), 'auto']} />
          {tooltip}
          {spec.series.map((s, i) => <Bar key={s.key} dataKey={s.key} fill={colorOf(i)} radius={histogram ? [2, 2, 0, 0] : [4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false} />)}
          <ReferenceLine y={0} stroke="var(--chart-axis)" />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (spec.type === 'line' || spec.type === 'area') {
    const showDots = spec.data.length <= 24;
    const Chart = spec.type === 'area' ? AreaChart : LineChart;
    return (
      <ResponsiveContainer width="100%" height={height}>
        <Chart data={spec.data} margin={margin}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={24} />
          <YAxis {...AXIS} axisLine={false} width={52} tickFormatter={yFmt} domain={spec.type === 'area' ? [(min: number) => Math.min(0, min), 'auto'] : ['auto', 'auto']} />
          {tooltip}
          {spec.series.map((s, i) => spec.type === 'area'
            ? <Area key={s.key} dataKey={s.key} type="linear" stroke={colorOf(i)} fill={colorOf(i)} fillOpacity={0.12} strokeWidth={2} isAnimationActive={false} connectNulls />
            : <Line key={s.key} dataKey={s.key} type="linear" stroke={colorOf(i)} strokeWidth={2} dot={showDots ? { r: 3, strokeWidth: 0, fill: colorOf(i) } : false} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls />)}
        </Chart>
      </ResponsiveContainer>
    );
  }

  // Scatter
  const xs = spec.data.map((d) => Number(d.x));
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={margin}>
        <CartesianGrid stroke="var(--chart-grid)" />
        <XAxis type="number" dataKey="x" name={spec.x.label} {...AXIS} tickFormatter={formatFor('number', true)} domain={['auto', 'auto']} />
        <YAxis type="number" dataKey="y" name={spec.y.label} {...AXIS} width={52} tickFormatter={formatFor('number', true)} domain={['auto', 'auto']} />
        <ZAxis range={[28, 28]} />
        {tooltip}
        {spec.series.map((s, i) => (
          <Scatter key={s.key} name={s.label} data={spec.data.filter((d) => d.series === s.key)} fill={colorOf(i)} fillOpacity={0.65} isAnimationActive={false} />
        ))}
        {spec.trend && Number.isFinite(minX) && (
          <ReferenceLine segment={[{ x: minX, y: spec.trend.slope * minX + spec.trend.intercept }, { x: maxX, y: spec.trend.slope * maxX + spec.trend.intercept }]}
            stroke="var(--chart-text)" strokeWidth={1.5} ifOverflow="extendDomain" />
        )}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

/** Correlation matrix as a real table: blue for positive, red for negative, intensity by strength, value always printed. */
function Heatmap({ spec }: { spec: ChartSpec }) {
  const m = spec.matrix;
  if (!m) return null;
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="border-separate border-spacing-0.5 text-xs">
        <caption className="sr-only">{spec.description}</caption>
        <thead>
          <tr>
            <td />
            {m.labels.map((l) => <th key={l} scope="col" className="max-w-[88px] truncate px-1 pb-1 text-left align-bottom font-medium text-muted" title={l}>{truncate(l, 12)}</th>)}
          </tr>
        </thead>
        <tbody>
          {m.labels.map((row, i) => (
            <tr key={row}>
              <th scope="row" className="max-w-[140px] truncate pr-2 text-right font-medium text-muted" title={row}>{truncate(row, 18)}</th>
              {m.values[i].map((v, j) => {
                const a = v === null ? 0 : Math.min(1, Math.abs(v));
                const bg = v === null ? 'rgb(var(--sunken))' : `rgb(var(${v >= 0 ? '--chart-pos' : '--chart-neg'}) / ${0.08 + a * 0.82})`;
                return (
                  <td key={j} className="h-10 w-16 min-w-[56px] rounded-sm text-center num" style={{ background: bg, color: a > 0.55 ? '#fff' : 'rgb(var(--fg))' }}
                    title={`${row} ↔ ${m.labels[j]}: ${v === null ? 'not enough data' : v.toFixed(2)}`}>
                    {v === null ? '—' : i === j ? '1' : v.toFixed(2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex items-center gap-2 text-2xs text-muted" aria-hidden>
        <span>−1</span>
        <span className="h-2 w-40 rounded-full" style={{ background: 'linear-gradient(90deg, rgb(var(--chart-neg)), rgb(var(--sunken)), rgb(var(--chart-pos)))' }} />
        <span>+1</span>
      </div>
    </div>
  );
}
