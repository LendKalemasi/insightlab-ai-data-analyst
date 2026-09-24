'use client';
import { useCallback, useRef, useState } from 'react';
import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { AnalysisResult, ColumnProfile, DatasetSchema } from '@/lib/types';
import { ResultCard } from '@/components/ResultCard';
import { Card, DataTable, ExecutionRail, Skeleton } from '@/components/ui';

interface Session {
  id: string; name: string; type: string;
  schema: DatasetSchema; quality_warnings: string[];
  profiles: ColumnProfile[]; sample: { columns: string[]; rows: Record<string, unknown>[] };
}

const STAGES = ['Interpreting question', 'Planning analysis', 'Generating SQL',
  'Validating query', 'Running analysis', 'Checking results', 'Preparing explanation'];

export default function Workspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const questionInputRef = useRef<HTMLInputElement>(null);
  const latestResultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (results.length > 0) latestResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [results.length]);

  const hydrate = useCallback(async (created: { id: string; name: string; type: string; schema: DatasetSchema; quality_warnings: string[] }) => {
    const [profileResponse, sampleResponse] = await Promise.all([
      fetch(`/api/datasources/${created.id}/profile`).then((response) => response.json()),
      fetch(`/api/datasources/${created.id}/sample?limit=20`).then((response) => response.json()),
    ]);
    setSession({ ...created, profiles: profileResponse.profiles, sample: sampleResponse });
    setResults([]);
  }, []);

  const load = async (body: BodyInit, headers?: HeadersInit) => {
    setError(null); setBusy('Reading dataset · inferring schema · profiling columns');
    try {
      const response = await fetch('/api/datasources', { method: 'POST', body, headers });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message ?? 'The dataset could not be loaded.');
      await hydrate(json);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Upload failed.'); }
    finally { setBusy(null); }
  };

  const ask = async (value: string) => {
    if (!session || !value.trim()) return;
    setError(null); setBusy(STAGES[0]);
    let stageIndex = 0;
    const timer = setInterval(() => { stageIndex = Math.min(stageIndex + 1, STAGES.length - 1); setBusy(STAGES[stageIndex]); }, 400);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data_source_id: session.id, question: value, history: results.map((result) => result.plan.question) }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message ?? 'The analysis failed.');
      setResults((previous) => [...previous, json as AnalysisResult]);
      setQuestion('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The analysis failed. You can retry.'); }
    finally { clearInterval(timer); setBusy(null); }
  };

  const prepareFollowUp = (value: string) => {
    setQuestion(`Follow-up on: ${value} — `);
    requestAnimationFrame(() => {
      questionInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      questionInputRef.current?.focus({ preventScroll: true });
    });
  };

  const suggestions = buildSuggestions(session?.profiles ?? []);
  const uploadFile = (file: File) => { const formData = new FormData(); formData.append('file', file); void load(formData); };
  const sourcePanel = <SourcePanel session={session} results={results} fileRef={fileRef}
    onLoadDemo={() => void load(JSON.stringify({ kind: 'demo' }), { 'content-type': 'application/json' })}
    onFile={uploadFile}
    onUpload={() => fileRef.current?.click()}
    onClear={() => { setSession(null); setResults([]); }} />;
  const contextPanel = session ? <ContextPanel session={session} /> : null;

  return (
    <main className="app-shell mx-auto max-w-[1600px] px-4 pb-12 sm:px-6 lg:px-8">
      <header className="topbar sticky top-0 z-20 -mx-4 mb-5 flex min-h-16 items-center justify-between px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-control bg-ink text-sm font-semibold text-surface">I</div>
          <div><p className="text-sm font-semibold text-ink">InsightLab</p><p className="text-meta text-muted">AI data analyst</p></div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-meta text-muted sm:inline">Read-only workspace</span>
          {session && <span className="rounded-full border border-line bg-canvas px-3 py-1 font-mono text-[11px] text-muted">{session.type} source</span>}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[208px_minmax(0,1fr)] xl:grid-cols-[224px_minmax(0,1fr)_304px]">
        <aside className="lg:row-span-2 lg:sticky lg:top-24 lg:self-start">
          <div className="hidden lg:block">{sourcePanel}</div>
          <div className="lg:hidden">
            <button type="button" aria-expanded={sourcesOpen} aria-controls="mobile-source-panel" onClick={() => setSourcesOpen((open) => !open)}
              className="flex min-h-11 w-full items-center justify-between rounded-control border border-line bg-surface px-4 py-3 text-sm font-medium text-ink">
              <span>Workspace tools</span><span aria-hidden="true">{sourcesOpen ? '−' : '+'}</span>
            </button>
            {sourcesOpen && <div id="mobile-source-panel" className="mt-2">{sourcePanel}</div>}
          </div>
        </aside>

        <section className="min-w-0">
          {!session && <section className="border-b border-line py-12 sm:py-20">
            <p className="text-meta font-medium text-cobalt">A read-only analysis workspace</p>
            <h1 className="mt-5 max-w-3xl text-display text-ink sm:text-[3.5rem] sm:leading-[3.75rem]">Ask questions. Understand your data.</h1>
            <p className="mt-6 max-w-2xl text-body text-muted">Upload a CSV or load the demo dataset to begin exploring your data. InsightLab profiles the dataset, plans an analysis, generates read-only SQL and Pandas code, executes it, and explains the result — showing every step.</p>
          </section>}

          {session && <>
            <section className="dataset-overview rounded-panel border border-line p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div><p className="text-meta font-medium text-teal">Dataset ready</p><h1 className="mt-2 break-words text-title text-ink">{session.name}</h1><p className="mt-2 text-body text-muted">Ask a question and inspect every step of the analysis.</p></div>
                <span className="rounded-full border border-line bg-canvas px-3 py-1 font-mono text-[11px] text-muted">{session.type}</span>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <div className="dataset-stat rounded-control px-3 py-2"><p className="text-meta text-muted">Rows</p><p className="mt-1 font-mono text-base font-medium text-ink">{session.schema.row_count.toLocaleString()}</p></div>
                <div className="dataset-stat rounded-control px-3 py-2"><p className="text-meta text-muted">Columns</p><p className="mt-1 font-mono text-base font-medium text-ink">{session.schema.columns.length}</p></div>
                <div className="dataset-stat rounded-control px-3 py-2"><p className="text-meta text-muted">Quality</p><p className={`mt-1 font-mono text-base font-medium ${session.quality_warnings.length ? 'text-copper' : 'text-teal'}`}>{session.quality_warnings.length ? 'Review' : 'Clear'}</p></div>
              </div>
            </section>
            <section className="question-panel mt-4 rounded-panel p-5 sm:p-6">
              <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-meta font-medium text-cobalt">Ask your data</p><h2 className="mt-1 text-heading text-ink">What would you like to understand?</h2></div><span className="text-meta text-muted">Natural language</span></div>
              <form className="mt-5 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void ask(question); }}>
                <input ref={questionInputRef} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="e.g. How has revenue changed over time?" aria-label="Question"
                  className="question-input min-h-12 flex-1 rounded-control border px-4 py-3 text-body" />
                <button type="submit" disabled={!!busy || !question.trim()} className="min-h-12 rounded-control bg-cobalt px-6 py-3 text-sm font-semibold text-surface hover:bg-ink disabled:opacity-50">Analyze</button>
              </form>
              <div className="mt-4 flex flex-wrap gap-2">{suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => void ask(suggestion)} disabled={!!busy} className="suggestion-chip disabled:opacity-50">{suggestion}</button>)}</div>
            </section>
          </>}

          {busy && session && <div className="mt-4 space-y-3"><ExecutionRail activeStage={busy} /><Skeleton label={`${busy}…`} /></div>}
          {busy && !session && <div className="mt-4"><Skeleton label={`${busy}…`} /></div>}
          {error && <Card className="mt-4 border-danger/30"><p className="text-body text-danger">{error}</p><button onClick={() => void ask(question)} className="mt-3 min-h-11 rounded-control border border-line px-3 py-2 text-sm font-medium text-ink">Retry</button></Card>}

          {session && !results.length && !busy && <Card className="mt-4">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2"><div><p className="text-meta font-medium text-muted">Sample rows</p><h2 className="mt-1 text-heading text-ink">Data preview</h2></div><p className="font-mono text-[11px] text-muted">First 20 records</p></div>
            <DataTable columns={session.sample.columns} rows={session.sample.rows} max={20} />
          </Card>}

          {results.map((result, index) => <div key={result.analysis_id} ref={index === results.length - 1 ? latestResultRef : undefined} className="scroll-mt-20"><ResultCard r={result} onFollowUp={prepareFollowUp} /></div>)}
        </section>

        <aside className="lg:col-span-2 xl:col-span-1">
          <div className="hidden xl:block xl:sticky xl:top-24">{contextPanel}</div>
          {session && <div className="xl:hidden">
            <button type="button" aria-expanded={contextOpen} aria-controls="responsive-context-panel" onClick={() => setContextOpen((open) => !open)}
              className="flex min-h-11 w-full items-center justify-between rounded-control border border-line bg-surface px-4 py-3 text-sm font-medium text-ink"><span>Data context</span><span aria-hidden="true">{contextOpen ? '−' : '+'}</span></button>
            {contextOpen && <div id="responsive-context-panel" className="mt-2">{contextPanel}</div>}
          </div>}
        </aside>
      </div>
    </main>
  );
}

function SourcePanel({ session, results, fileRef, onLoadDemo, onFile, onUpload, onClear }: { session: Session | null; results: AnalysisResult[]; fileRef: MutableRefObject<HTMLInputElement | null>; onLoadDemo: () => void; onFile: (file: File) => void; onUpload: () => void; onClear: () => void }) {
  return <div className="space-y-4"><Card className="workspace-nav">
    <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Workspace tools</h2><span className="h-2 w-2 rounded-full bg-teal" aria-label="System ready" /></div>
    <p className="mt-4 text-body text-surface/70">Load a dataset, then ask questions in plain language.</p>
    <button onClick={onLoadDemo} className="mt-5 min-h-11 w-full rounded-control bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-canvas">Load demo dataset</button>
    <button onClick={onUpload} className="mt-2 min-h-11 w-full rounded-control border border-surface/25 px-3 py-2 text-sm font-medium text-surface hover:border-surface hover:bg-surface/10">Upload CSV</button>
    <input ref={(element) => { fileRef.current = element; }} type="file" accept=".csv" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); }} />
    {session && <button onClick={onClear} className="mt-2 min-h-11 w-full rounded-control border border-surface/20 px-3 py-2 text-sm text-surface/70 hover:border-surface hover:text-surface">Clear dataset</button>}
  </Card>{results.length > 0 && <Card><p className="text-meta font-medium text-muted">History</p>{results.map((result, index) => <p key={result.analysis_id} className="truncate border-b border-line py-3 text-sm text-ink last:border-0"><span className="mr-2 font-mono text-[11px] text-muted">{String(index + 1).padStart(2, '0')}</span>{result.plan.question}</p>)}</Card>}</div>;
}

function ContextPanel({ session }: { session: Session }) {
  return <Card className="inspector-panel"><div className="flex items-center justify-between"><h2 className="text-heading text-ink">Data context</h2><span className="font-mono text-[11px] text-muted">{session.schema.columns.length} fields</span></div>
    <div className="mt-5 max-h-80 overflow-auto rounded-control border border-line"><table className="w-full text-sm"><thead className="sticky top-0 bg-surface2"><tr className="text-left text-meta text-muted"><th className="px-3 py-2 font-medium">Column</th><th className="px-3 py-2 font-medium">Type</th><th className="px-3 py-2 text-right font-medium">Null%</th></tr></thead><tbody>{session.profiles.map((profile) => <tr key={profile.column_name} className="border-b border-line last:border-0"><td className="px-3 py-2 text-ink">{profile.column_name}</td><td className="px-3 py-2 font-mono text-[11px] text-muted">{profile.inferred_type}</td><td className="px-3 py-2 text-right font-mono text-[11px] text-muted">{profile.null_percentage.toFixed(1)}</td></tr>)}</tbody></table></div>
    <h3 className="mt-6 text-sm font-semibold text-ink">Data quality</h3>{session.quality_warnings.length ? session.quality_warnings.map((warning, index) => <p key={index} className="mt-2 border-l-2 border-copper pl-3 text-meta text-copper">{warning}</p>) : <p className="mt-2 text-meta text-teal">No issues detected.</p>}
  </Card>;
}

function buildSuggestions(profiles: ColumnProfile[]): string[] {
  const numeric = profiles.filter((profile) => profile.inferred_type === 'numeric');
  const categorical = profiles.filter((profile) => profile.inferred_type === 'categorical');
  const date = profiles.find((profile) => profile.inferred_type === 'date');
  const suggestions: string[] = [];
  if (date && numeric[0]) suggestions.push(`How has ${numeric[0].column_name} changed over time?`);
  if (categorical[0] && numeric[0]) suggestions.push(`Which ${categorical[0].column_name} has the highest ${numeric[0].column_name}?`);
  if (categorical[1] && numeric[0]) suggestions.push(`Compare ${numeric[0].column_name} by ${categorical[1].column_name}`);
  if (numeric.length > 1) suggestions.push('What are the strongest correlations between numeric variables?');
  if (profiles.some((profile) => profile.null_count > 0)) suggestions.push('Which columns have the most missing data?');
  return suggestions.slice(0, 5);
}
