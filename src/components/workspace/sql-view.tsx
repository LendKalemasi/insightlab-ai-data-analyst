'use client';
import { Play, ShieldCheck } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/client/api';
import type { TableResult } from '@/lib/types';
import { ResultTable } from '../charts/result-table';
import { Alert, Button, Kbd } from '../ui';
import { typeIcon } from './column-meta';
import { useDataset } from './context';

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

export function SqlView() {
  const { info, id } = useDataset();
  const examples = useMemo(() => {
    const num = info.columns.find((c) => c.type === 'numeric');
    const cat = info.columns.find((c) => c.type === 'categorical');
    const date = info.columns.find((c) => c.type === 'date');
    const out = ['SELECT *\nFROM dataset\nLIMIT 20'];
    if (num && cat) out.push(`SELECT ${quote(cat.name)}, COUNT(*) AS rows, ROUND(SUM(${quote(num.name)}), 2) AS total_${num.name.replace(/\W+/g, '_')}\nFROM dataset\nGROUP BY 1\nORDER BY 3 DESC`);
    if (num && date) out.push(`SELECT substr(${quote(date.name)}, 1, 7) AS month, ROUND(AVG(${quote(num.name)}), 2) AS avg_${num.name.replace(/\W+/g, '_')}\nFROM dataset\nGROUP BY month\nORDER BY month`);
    return out;
  }, [info]);
  const [sql, setSql] = useState(examples[1] ?? examples[0]);
  const [result, setResult] = useState<(TableResult & { sql: string; ms: number; warnings: string[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);

  const run = async () => {
    if (running || !sql.trim()) return;
    setRunning(true); setError(null);
    try {
      setResult(await api.query(id, sql));
    } catch (e) {
      setResult(null);
      setError(e instanceof ApiError ? e.message : 'The query failed.');
    } finally { setRunning(false); }
  };

  const insert = (text: string) => {
    const el = editor.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const next = sql.slice(0, s) + text + sql.slice(e);
    setSql(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + text.length, s + text.length); });
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div className="min-w-0 space-y-4">
        <section className="card overflow-hidden" aria-label="SQL editor">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
            <p className="flex items-center gap-1.5 text-xs text-muted"><ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden />Read-only · one SELECT on the table <code className="text-fg">dataset</code></p>
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="sql-example">Example queries</label>
              <select id="sql-example" className="h-8 max-w-[180px] rounded-md border border-line-strong bg-surface px-2 text-xs" value="" onChange={(e) => { if (e.target.value) setSql(e.target.value); }}>
                <option value="">Examples…</option>
                {examples.map((ex, i) => <option key={i} value={ex}>{ex.split('\n')[0].slice(0, 40)}{i === 0 ? ' (preview)' : ''}</option>)}
              </select>
              <Button size="sm" variant="primary" onClick={run} loading={running} icon={<Play className="h-3.5 w-3.5" aria-hidden />}>Run</Button>
            </div>
          </div>
          <label htmlFor="sql-editor" className="sr-only">SQL query</label>
          <textarea id="sql-editor" ref={editor} value={sql} spellCheck={false} rows={9}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void run(); } }}
            className="block w-full resize-y bg-surface px-4 py-3 font-mono text-[13px] leading-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 focus-visible:ring-offset-0" />
          <p className="border-t border-line px-3 py-1.5 text-2xs text-muted">Press <Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd> to run. A LIMIT is added when you do not set one.</p>
        </section>

        {error && <Alert tone="danger" title="Query failed">{error}</Alert>}
        {result && (
          <section className="card p-4" aria-label="Query result">
            <p className="mb-3 text-xs text-muted num">{result.row_count.toLocaleString('en-US')} rows in {result.ms} ms</p>
            {result.warnings.map((w) => <Alert key={w} tone="warning" className="mb-3">{w}</Alert>)}
            <ResultTable result={result} fileName="query-result" maxHeight={480} />
          </section>
        )}
      </div>

      <aside className="card h-fit p-3 lg:sticky lg:top-20" aria-label="Columns">
        <p className="eyebrow px-1">Columns · click to insert</p>
        <ul className="mt-2 max-h-[60vh] space-y-0.5 overflow-y-auto scroll-thin">
          {info.columns.map((c) => {
            const Icon = typeIcon(c.type);
            return (
              <li key={c.name}>
                <button type="button" onClick={() => insert(quote(c.name))} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[13px] hover:bg-sunken">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
                  <span className="truncate font-mono">{c.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}
