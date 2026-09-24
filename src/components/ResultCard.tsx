'use client';
import type { AnalysisResult } from '@/lib/types';
import { AnalysisChart } from './AnalysisChart';
import { Card, CodeBlock, DataTable, ExecutionRail, Tabs } from './ui';

export function ResultCard({ r, onFollowUp }: { r: AnalysisResult; onFollowUp: (q: string) => void }) {
  const rows = r.result?.rows ?? [];
  const download = async (format: 'csv' | 'json') => {
    const res = await fetch('/api/export', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file_name: r.analysis_id, format, columns: r.result?.columns ?? [], rows }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${r.analysis_id}.${format}`; anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="result-card mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="text-meta font-medium text-teal">Analysis result</p>
          <p className="mt-2 max-w-2xl text-body font-medium text-ink">{r.plan.question}</p>
        </div>
        <code className="rounded-full border border-line px-2.5 py-1 font-mono text-[11px] text-muted">{r.analysis_id}</code>
      </div>
      <div className="mt-5"><ExecutionRail completed trace={r.trace} /></div>
      <p className="result-answer mt-6 text-[1.0625rem] leading-7 text-ink">{r.answer}</p>
      {r.key_findings.length > 0 && <ul className="mt-4 list-disc space-y-1 pl-5 text-body text-muted">{r.key_findings.map((finding, index) => <li key={index}>{finding}</li>)}</ul>}

      {rows.length > 0 && <div className="mt-5 grid min-h-[84px] grid-cols-2 gap-3 sm:grid-cols-3">
        {rows.slice(0, 3).map((row, index) => {
          const [key, value] = [Object.keys(row)[0], Object.values(row)[1]];
          return <div key={index} className="rounded-control border border-line bg-canvas p-3"><span className="text-meta text-muted">{String(row[key])}</span><b className="mt-1 block font-mono text-base font-medium text-ink">{typeof value === 'number' ? value.toLocaleString() : String(value)}</b></div>;
        })}
      </div>}

      <div className="mt-6">
        <Tabs tabs={[
          { label: 'Visualization', content: r.chart ? <div className="stable-chart"><AnalysisChart chart={r.chart} rows={rows} /></div> : <p className="text-body text-muted">A chart would not add meaning here; the exact values are in the Data tab.</p> },
          { label: 'Data', content: <DataTable columns={r.result?.columns ?? []} rows={rows} /> },
          { label: 'SQL', content: r.sql ? <CodeBlock code={r.sql} language="SQL" /> : <p className="text-body text-muted">This analysis did not require SQL.</p> },
          { label: 'Python', content: r.python ? <><CodeBlock code={`import pandas as pd\n# df is provided read-only by the sandbox\n${r.python}`} language="Python" /><p className="mt-3 text-meta text-muted">{r.python_executed ? 'Executed and validated in the sandboxed analysis service.' : 'Generated but not executed because the Python service is unavailable.'}</p></> : <p className="text-body text-muted">No Python step was generated.</p> },
          { label: 'Plan', content: <CodeBlock code={JSON.stringify(r.plan, null, 2)} language="JSON" /> },
          { label: 'Trace', content: <div className="space-y-2 text-meta">{r.trace.map((event, index) => <div key={index} className="flex flex-wrap justify-between gap-3 border-b border-line py-2"><span className="text-ink">{event.tool} <span className="text-muted">{event.detail}</span></span><span className={event.status === 'error' ? 'text-danger' : event.status === 'skipped' ? 'text-copper' : 'text-teal'}>{event.status} · {event.duration_ms} ms</span></div>)}</div> },
        ]} />
      </div>

      {r.assumptions.map((assumption, index) => <p key={index} className="mt-3 border-l-2 border-line pl-3 text-meta text-muted">Assumption: {assumption}</p>)}
      {r.warnings.map((warning, index) => <p key={index} className="mt-2 border-l-2 border-copper pl-3 text-meta text-copper">{warning}</p>)}
      <div className="mt-5 flex flex-wrap gap-2">
        <button onClick={() => download('csv')} className="min-h-11 rounded-control border border-line bg-surface px-3 py-2 text-sm font-medium text-muted hover:border-cobalt hover:text-ink">Download CSV</button>
        <button onClick={() => download('json')} className="min-h-11 rounded-control border border-line bg-surface px-3 py-2 text-sm font-medium text-muted hover:border-cobalt hover:text-ink">Download JSON</button>
        <button onClick={() => onFollowUp(r.plan.question)} className="min-h-11 rounded-control bg-ink px-3 py-2 text-sm font-medium text-surface hover:bg-cobalt">Ask follow-up</button>
      </div>
    </Card>
  );
}
