'use client';
import { ArrowUp, Check, Cpu, FileDown, Loader2, MessageSquareText, RotateCcw, Sparkles, Square, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnalysisStage } from '@/lib/types';
import { downloadText, safeFileName } from '../charts/export';
import { useAppStatus } from '../app/chrome';
import { Alert, Button, ConfirmDialog, cx, IconButton, Kbd } from '../ui';
import { useDataset, type PendingAnalysis } from '../workspace/context';
import { buildReport } from './report';
import { buildSuggestions } from './suggestions';
import { SuggestionChip, Turn, UserBubble } from './turn';

export function AskView() {
  const ws = useDataset();
  const { info, turns, turnsLoaded, pending, failure, ask, cancel, dismissFailure, clearConversation } = ws;
  const status = useAppStatus();
  const scroller = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const suggestions = useMemo(() => buildSuggestions(info), [info]);
  const busy = !!pending;

  // Follow the conversation: scroll to the newest item whenever one is added or starts.
  const initialScrollDone = useRef(false);
  useEffect(() => {
    if (!turnsLoaded) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!initialScrollDone.current) {
      // Charts size themselves after the first paint; jump once they have.
      initialScrollDone.current = true;
      const t = setTimeout(() => endRef.current?.scrollIntoView({ block: 'end' }), 150);
      return () => clearTimeout(t);
    }
    endRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'end' });
  }, [turns.length, !!pending, !!failure, turnsLoaded]);

  const exportReport = () => downloadText(buildReport(info, turns), `${safeFileName(info.name)}-analysis.md`, 'text/markdown');

  return (
    <div className="flex h-[calc(100dvh-6.5rem)] flex-col lg:h-[calc(100dvh-3.5rem)]">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6">
          {turns.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted">{turns.length} question{turns.length === 1 ? '' : 's'} · saved with this dataset</p>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={exportReport} icon={<FileDown className="h-3.5 w-3.5" aria-hidden />}>Export report</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)} disabled={busy} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}>Clear</Button>
              </div>
            </div>
          )}

          {!turnsLoaded ? (
            <div className="space-y-3" aria-busy="true"><div className="skeleton ml-auto h-10 w-1/2" /><div className="skeleton h-48" /></div>
          ) : turns.length === 0 && !pending && !failure ? (
            <div className="mx-auto max-w-2xl py-6 text-center sm:py-12">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary-soft text-primary"><MessageSquareText className="h-5 w-5" aria-hidden /></div>
              <h2 className="mt-4 text-xl font-semibold tracking-tight">What would you like to know?</h2>
              <p className="mt-2 text-sm text-muted">
                Ask about totals, trends, comparisons, distributions, correlations, outliers or data quality in <strong className="text-fg">{info.name}</strong>.
                Every answer shows the calculated values and the SQL behind them.
              </p>
              {status && !status.ai.configured && (
                <Alert tone="info" className="mt-5 text-left" title="Rule-based mode">
                  {status.ai.message} Phrasing it like the suggestions below works best.
                </Alert>
              )}
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {suggestions.map((q) => <SuggestionChip key={q} onClick={() => void ask(q)}>{q}</SuggestionChip>)}
              </div>
            </div>
          ) : null}

          {turns.map((t) => <Turn key={t.id} turn={t} info={info} onAsk={(q) => void ask(q)} busy={busy} />)}

          {pending && <PendingTurn pending={pending} usesAi={!!status?.ai.configured} onCancel={cancel} />}

          {failure && !pending && (
            <div className="space-y-3">
              <UserBubble>{failure.question}</UserBubble>
              <Alert tone="danger" title="The question was not answered"
                action={<div className="flex gap-2"><Button size="sm" variant="ghost" onClick={dismissFailure}>Dismiss</Button><Button size="sm" onClick={() => void ask(failure.question)} icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}>Retry</Button></div>}>
                {failure.message}
              </Alert>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <Composer />

      <ConfirmDialog open={confirmClear} onClose={() => setConfirmClear(false)} confirmLabel="Clear conversation"
        onConfirm={async () => { await clearConversation(); setConfirmClear(false); }} title="Clear this conversation?">
        All questions and answers for this dataset will be deleted. The dataset itself is kept.
      </ConfirmDialog>
    </div>
  );
}

const STAGES: { id: AnalysisStage; label: string; ai?: boolean }[] = [
  { id: 'planning', label: 'Plan the analysis' },
  { id: 'querying', label: 'Run SQL and statistics' },
  { id: 'interpreting', label: 'Write the interpretation', ai: true },
];

function PendingTurn({ pending, usesAi, onCancel }: { pending: PendingAnalysis; usesAi: boolean; onCancel: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - pending.startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [pending.startedAt]);
  const stages = STAGES.filter((s) => !s.ai || usesAi);
  const activeIndex = pending.stage === 'sending' ? -1 : stages.findIndex((s) => s.id === pending.stage);
  return (
    <div className="space-y-3">
      <UserBubble>{pending.question}</UserBubble>
      <div className="card px-4 py-4 sm:px-5" aria-live="polite" aria-busy="true">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            {usesAi ? <Sparkles className="h-4 w-4 text-ai" aria-hidden /> : <Cpu className="h-4 w-4 text-muted" aria-hidden />}
            {pending.message}…
          </p>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted num">{elapsed}s</span>
            <Button size="sm" onClick={onCancel} icon={<Square className="h-3 w-3" aria-hidden />}>Stop</Button>
          </div>
        </div>
        <ol className="mt-4 grid gap-2 sm:grid-cols-3">
          {stages.map((s, i) => {
            const done = i < activeIndex, active = i === activeIndex;
            return (
              <li key={s.id} className={cx('flex items-center gap-2 rounded-md border px-3 py-2 text-xs', active ? 'border-primary/30 bg-primary-soft text-primary' : done ? 'border-line text-fg' : 'border-line text-muted')}>
                {done ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : active ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <span className="h-3.5 w-3.5 rounded-full border border-line-strong" aria-hidden />}
                {s.label}
                <span className="sr-only">{done ? '(done)' : active ? '(in progress)' : '(waiting)'}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

const MAX_QUESTION = 1000;

function Composer() {
  const { info, draft, setDraft, ask, pending } = useDataset();
  const ref = useRef<HTMLTextAreaElement>(null);
  const busy = !!pending;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [draft]);
  // Focus once on arrival when another tab pre-filled a question.
  const initialDraft = useRef(draft);
  useEffect(() => { if (initialDraft.current) ref.current?.focus(); }, []);

  const submit = () => {
    const q = draft.trim();
    if (!q || busy || q.length > MAX_QUESTION) return;
    setDraft('');
    void ask(q);
  };

  return (
    <div className="border-t border-line bg-surface/95 backdrop-blur">
      <form className="mx-auto max-w-4xl px-4 py-3 sm:px-6" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="flex items-end gap-2 rounded-lg border border-line-strong bg-surface p-1.5 shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <label htmlFor="question" className="sr-only">Ask a question about {info.name}</label>
          <textarea id="question" ref={ref} rows={1} value={draft} maxLength={MAX_QUESTION + 200}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            placeholder="Ask a question about this dataset…"
            className="min-h-[40px] flex-1 resize-none bg-transparent px-2.5 py-2 text-[15px] placeholder:text-subtle focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0" />
          <IconButton type="submit" label={busy ? 'Wait for the current analysis' : 'Ask'} variant="primary" disabled={!draft.trim() || busy || draft.length > MAX_QUESTION}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowUp className="h-4 w-4" aria-hidden />}
          </IconButton>
        </div>
        <div className="mt-1.5 flex justify-between px-1 text-2xs text-muted">
          <span><Kbd>Enter</Kbd> to ask · <Kbd>Shift</Kbd> + <Kbd>Enter</Kbd> for a new line</span>
          {draft.length > MAX_QUESTION * 0.8 && <span className={cx('num', draft.length > MAX_QUESTION && 'text-danger')}>{draft.length}/{MAX_QUESTION}</span>}
        </div>
      </form>
    </div>
  );
}
