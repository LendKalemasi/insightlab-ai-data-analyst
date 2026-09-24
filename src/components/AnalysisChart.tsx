'use client';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { AnalysisResult } from '@/lib/types';

/**
 * Charts never truncate the y-axis (domain starts at 0) so comparisons are not
 * visually exaggerated, and every chart carries a text description.
 */
export function AnalysisChart({ chart, rows }: { chart: NonNullable<AnalysisResult['chart']>; rows: Record<string, unknown>[] }) {
  if (!rows.length) return <p className="text-sm text-slate-400">No data to plot.</p>;
  const y = chart.y_columns[0];
  const data = rows.map((r) => ({ ...r, [y]: Number(r[y]) }));
  const common = (
    <>
      <CartesianGrid stroke="var(--chart-grid)" />
      <XAxis dataKey={chart.x_column} stroke="var(--chart-muted)" fontSize={11}
        label={{ value: chart.x_label, position: 'insideBottom', offset: -4, fill: 'var(--chart-muted)', fontSize: 11 }} />
      <YAxis stroke="var(--chart-muted)" fontSize={11} domain={[0, 'auto']}
        label={{ value: chart.y_label, angle: -90, position: 'insideLeft', fill: 'var(--chart-muted)', fontSize: 11 }} />
      <Tooltip contentStyle={{ background: 'var(--chart-surface)', color: 'var(--chart-ink)', border: '1px solid var(--chart-grid)', borderRadius: 7 }} />
      <Legend wrapperStyle={{ color: 'var(--chart-muted)', fontSize: 12 }} />
    </>
  );
  return (
    <figure>
      <h4 className="mb-2 text-[13px] font-normal leading-[19px] text-muted">{chart.title}</h4>
      <ResponsiveContainer width="100%" height={280}>
        {chart.chart_type === 'line'
          ? <LineChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
              {common}<Line type="monotone" dataKey={y} stroke="var(--chart-primary)" strokeWidth={2} dot={false} />
            </LineChart>
          : <BarChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
              {common}<Bar dataKey={y} fill="var(--chart-primary)" radius={[5, 5, 0, 0]} />
            </BarChart>}
      </ResponsiveContainer>
      <figcaption className="mt-1 text-[13px] font-normal leading-[19px] text-muted">{chart.accessibility_description}</figcaption>
    </figure>
  );
}
