import { formatNumber } from '../format';
import type { ChartSpec, ValueFormat } from '../types';
import type { ChartPreference } from './spec';

/**
 * Chart selection is deterministic: the shape of the result picks the form,
 * a user's explicit preference can only switch between forms that suit the
 * data, and every chart is trimmed to a readable size with a note saying so.
 */
export const MISSING_LABEL = '(missing)';
const MAX_BARS = 25;
const MAX_LINE_SERIES = 5;

export const labelOf = (v: unknown): string => (v === null || v === undefined || v === '' ? MISSING_LABEL : String(v));

interface Base {
  title: string;
  xLabel: string;
  yLabel: string;
  format: ValueFormat;
  preference: ChartPreference;
}

const describeRange = (values: number[]) => values.length
  ? `values range from ${formatNumber(Math.min(...values))} to ${formatNumber(Math.max(...values))}`
  : 'no values';

export function categoryChart(rows: Record<string, unknown>[], labelKey: string, valueKey: string, base: Base & { sortedByValue: boolean }): ChartSpec | null {
  if (base.preference === 'none' || base.preference === 'table') return null;
  const points = rows.map((r) => ({ label: labelOf(r[labelKey]), value: Number(r[valueKey]) })).filter((p) => Number.isFinite(p.value));
  if (points.length < 2) return null; // one bar is a number, not a chart
  const shown = points.slice(0, MAX_BARS);
  const long = shown.length > 8 || Math.max(...shown.map((p) => p.label.length)) > 14;
  return {
    type: base.preference === 'line' || base.preference === 'area' ? 'bar' : long ? 'hbar' : 'bar',
    title: base.title,
    description: `Bar chart of ${base.yLabel} for ${shown.length} ${base.xLabel} groups; ${describeRange(shown.map((p) => p.value))}.`,
    x: { key: 'label', label: base.xLabel, kind: 'category' },
    y: { label: base.yLabel, format: base.format },
    series: [{ key: 's0', label: base.yLabel }],
    data: shown.map((p) => ({ label: p.label, s0: p.value })),
    note: points.length > MAX_BARS
      ? `Showing the ${base.sortedByValue ? 'largest' : 'first'} ${MAX_BARS} of ${points.length} groups; the table has all of them.`
      : null,
  };
}

export function timeChart(rows: Record<string, unknown>[], timeKey: string, valueKey: string, base: Base): ChartSpec | null {
  if (base.preference === 'none' || base.preference === 'table') return null;
  const all = rows.map((r) => ({ t: r[timeKey], value: Number(r[valueKey]) }));
  const points = all.filter((p) => p.t !== null && p.t !== undefined && Number.isFinite(p.value)).map((p) => ({ label: String(p.t), value: p.value }));
  if (points.length < 2) return null;
  const dropped = all.length - points.length;
  const type = base.preference === 'bar' || points.length <= 3 ? 'bar' : base.preference === 'area' ? 'area' : 'line';
  return {
    type,
    title: base.title,
    description: `${type === 'bar' ? 'Bar' : 'Line'} chart of ${base.yLabel} over ${points.length} periods from ${points[0].label} to ${points[points.length - 1].label}; ${describeRange(points.map((p) => p.value))}.`,
    x: { key: 'label', label: base.xLabel, kind: 'time' },
    y: { label: base.yLabel, format: base.format },
    series: [{ key: 's0', label: base.yLabel }],
    data: points.map((p) => ({ label: p.label, s0: p.value })),
    note: dropped ? `${dropped} group${dropped > 1 ? 's' : ''} with a missing date ${dropped > 1 ? 'are' : 'is'} in the table but not on the chart.` : null,
  };
}

/**
 * Two grouping columns: x is the first (time or category), series is the
 * second. Series beyond the largest few are folded into "Other" when the
 * measure is additive (sum/count), and dropped with a note when it is not.
 */
export function pivotChart(rows: Record<string, unknown>[], xKey: string, seriesKey: string, valueKey: string, base: Base & { xIsTime: boolean; additive: boolean }): ChartSpec | null {
  if (base.preference === 'none' || base.preference === 'table') return null;
  const totals = new Map<string, number>();
  for (const r of rows) {
    const v = Number(r[valueKey]);
    if (Number.isFinite(v)) totals.set(labelOf(r[seriesKey]), (totals.get(labelOf(r[seriesKey])) ?? 0) + Math.abs(v));
  }
  const maxSeries = base.xIsTime ? MAX_LINE_SERIES : 4;
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const kept = ranked.slice(0, maxSeries);
  const folded = ranked.length > kept.length;
  const seriesLabels = folded && base.additive ? [...kept, 'Other'] : kept;
  const keyFor = new Map(seriesLabels.map((label, i) => [label, `s${i}`]));

  const byX = new Map<string, Record<string, unknown>>();
  const xOrder: string[] = [];
  for (const r of rows) {
    if (base.xIsTime && (r[xKey] === null || r[xKey] === undefined)) continue;
    const x = labelOf(r[xKey]);
    if (!byX.has(x)) { byX.set(x, { label: x }); xOrder.push(x); }
    const s = labelOf(r[seriesKey]);
    const key = keyFor.get(kept.includes(s) ? s : 'Other');
    const v = Number(r[valueKey]);
    if (!key || !Number.isFinite(v)) continue;
    const point = byX.get(x)!;
    point[key] = (Number(point[key]) || 0) + v;
  }
  let xs = base.xIsTime ? [...xOrder].sort() : xOrder;
  let xNote: string | null = null;
  if (!base.xIsTime && xs.length > 12) {
    const xTotals = xs.map((x) => [x, seriesLabels.reduce((s, l) => s + Math.abs(Number(byX.get(x)![keyFor.get(l)!]) || 0), 0)] as const);
    xs = xTotals.sort((a, b) => b[1] - a[1]).slice(0, 12).map(([x]) => x);
    xNote = `Showing the 12 largest of ${xOrder.length} ${base.xLabel} groups.`;
  }
  if (xs.length < 2 && seriesLabels.length < 2) return null;
  const notes = [xNote, folded ? (base.additive ? 'Smaller groups are combined into "Other".' : `Only the ${kept.length} largest series are drawn; the table has all of them.`) : null].filter(Boolean);
  const type = base.xIsTime ? (base.preference === 'bar' ? 'bar' : base.preference === 'area' ? 'area' : 'line') : 'bar';
  return {
    type,
    title: base.title,
    description: `${type === 'bar' ? 'Grouped bar' : 'Line'} chart of ${base.yLabel} by ${base.xLabel}, one ${type === 'bar' ? 'bar' : 'line'} per series: ${seriesLabels.join(', ')}.`,
    x: { key: 'label', label: base.xLabel, kind: base.xIsTime ? 'time' : 'category' },
    y: { label: base.yLabel, format: base.format },
    series: seriesLabels.map((label) => ({ key: keyFor.get(label)!, label })),
    data: xs.map((x) => byX.get(x)!),
    note: notes.length ? notes.join(' ') : null,
  };
}

export function histogramChart(bins: { start: number; end: number; count: number }[], base: Omit<Base, 'format'> & { references?: { value: number; label: string }[] }): ChartSpec | null {
  if (base.preference === 'none' || base.preference === 'table' || bins.length < 2) return null;
  const total = bins.reduce((s, b) => s + b.count, 0);
  const peak = bins.reduce((a, b) => (b.count > a.count ? b : a));
  return {
    type: 'histogram',
    title: base.title,
    description: `Histogram of ${base.xLabel} in ${bins.length} bins covering ${total} values; the most common range is ${formatNumber(peak.start)} to ${formatNumber(peak.end)} (${peak.count} values).`,
    x: { key: 'label', label: base.xLabel, kind: 'number' },
    y: { label: base.yLabel, format: 'integer' },
    series: [{ key: 's0', label: 'Rows' }],
    data: bins.map((b) => ({ label: `${formatNumber(b.start)}–${formatNumber(b.end)}`, start: b.start, end: b.end, s0: b.count })),
    note: base.references?.length ? base.references.map((r) => `${r.label}: ${formatNumber(r.value)}`).join(' · ') : null,
  };
}

export function scatterChart(points: { x: number; y: number; group: string | null }[], base: Omit<Base, 'format'> & { trend: { slope: number; intercept: number } | null; note: string | null; groups: string[] }): ChartSpec | null {
  if (base.preference === 'none' || base.preference === 'table' || points.length < 3) return null;
  const groups = base.groups.length ? base.groups : ['All rows'];
  const keyFor = new Map(groups.map((g, i) => [g, `s${i}`]));
  return {
    type: 'scatter',
    title: base.title,
    description: `Scatter plot of ${base.yLabel} against ${base.xLabel} for ${points.length} rows${base.trend ? ', with a least-squares trend line' : ''}.`,
    x: { key: 'x', label: base.xLabel, kind: 'number' },
    y: { label: base.yLabel, format: 'number' },
    series: groups.map((g) => ({ key: keyFor.get(g)!, label: g })),
    data: points.map((p) => ({ x: p.x, y: p.y, series: keyFor.get(p.group ?? groups[0]) ?? 's0' })),
    note: base.note,
    trend: base.trend,
  };
}

export function heatmapChart(labels: string[], values: (number | null)[][], title: string): ChartSpec {
  return {
    type: 'heatmap',
    title,
    description: `Correlation matrix for ${labels.length} numeric columns. Blue cells are positive, red negative; darker means stronger.`,
    x: { key: 'column', label: 'Column', kind: 'category' },
    y: { label: 'Correlation', format: 'correlation' },
    series: [],
    data: [],
    note: null,
    matrix: { labels, values },
  };
}
