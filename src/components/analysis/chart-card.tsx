'use client';
import { Download } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ChartSpec } from '@/lib/types';
import { ChartView, isNeutralSeries, Legend } from '../charts/chart-view';
import { exportChart } from '../charts/export';
import { Button } from '../ui';

export function ChartCard({ spec }: { spec: ChartSpec }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const exportable = spec.type !== 'heatmap';

  const save = async (format: 'png' | 'svg') => {
    if (!ref.current) return;
    const css = getComputedStyle(document.documentElement);
    const legend = spec.series.map((s, i) => ({ label: s.label, color: isNeutralSeries(s.label) ? css.getPropertyValue('--chart-text').trim() : css.getPropertyValue(`--series-${(i % 8) + 1}`).trim() }));
    setFailed(!(await exportChart(ref.current, spec.title, legend, format).catch(() => false)));
  };

  return (
    <figure className="rounded-md border border-line p-4">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <figcaption className="text-sm font-semibold">{spec.title}</figcaption>
        {exportable && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => save('png')} icon={<Download className="h-3.5 w-3.5" aria-hidden />} aria-label={`Download ${spec.title} as PNG`}>PNG</Button>
            <Button size="sm" variant="ghost" onClick={() => save('svg')} aria-label={`Download ${spec.title} as SVG`}>SVG</Button>
          </div>
        )}
      </div>
      <Legend spec={spec} />
      <div ref={ref} role={exportable ? 'img' : undefined} aria-label={exportable ? spec.description : undefined}>
        <ChartView spec={spec} />
      </div>
      <p className="mt-2 text-xs text-muted">{spec.description}</p>
      {spec.note && <p className="mt-1 text-xs text-muted">{spec.note}</p>}
      {failed && <p className="mt-1 text-xs text-danger" role="alert">The chart could not be exported in this browser.</p>}
    </figure>
  );
}
