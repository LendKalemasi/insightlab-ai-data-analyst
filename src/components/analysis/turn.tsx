'use client';
import {
  AlertTriangle, Calculator, Check, CheckCircle2, CircleHelp, Copy, Cpu, Database, HelpCircle, Info, RotateCcw, ShieldAlert, ShieldCheck, Sparkles, XCircle,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { AnalysisTurn, DatasetInfo } from '@/lib/types';
import { ResultTable } from '../charts/result-table';
import { Alert, Badge, Button, cx, Tabs } from '../ui';
import { ChartCard } from './chart-card';
import { buildSuggestions } from './suggestions';

export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-primary px-4 py-2.5 text-[15px] text-primary-fg shadow-sm">{children}</p>
    </div>
  );
}

const STATUS = {
  answered: { label: 'Answered', tone: 'success', icon: CheckCircle2 },
  clarification: { label: 'Needs clarification', tone: 'primary', icon: CircleHelp },
  unsupported: { label: 'Cannot answer from this data', tone: 'warning', icon: HelpCircle },
  error: { label: 'Failed', tone: 'danger', icon: XCircle },
} as const;

export function Turn({ turn, info, onAsk, busy }: { turn: AnalysisTurn; info: DatasetInfo; onAsk: (q: string) => void; busy: boolean }) {
  const s = STATUS[turn.status];
  const StatusIcon = s.icon;
  const time = new Date(turn.created_at);
  return (
    <article className="animate-fade-up space-y-3" aria-label={`Question: ${turn.question}`}>
      <UserBubble>{turn.question}</UserBubble>
      <div className="card overflow-hidden">
        <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 sm:px-5">
          <Badge tone={s.tone} icon={<StatusIcon className="h-3 w-3" aria-hidden />}>{s.label}</Badge>
          <span className="inline-flex items-center gap-1 text-2xs text-muted" title={turn.planner.kind === 'anthropic' ? 'Planned and explained by Claude; numbers computed by SQL' : 'Planned by built-in rules; numbers computed by SQL'}>
            {turn.planner.kind === 'anthropic' ? <Sparkles className="h-3 w-3 text-ai" aria-hidden /> : <Cpu className="h-3 w-3" aria-hidden />}
            {turn.planner.kind === 'anthropic' ? (turn.planner.model ?? 'Claude') : 'Rule-based planner'}
          </span>
          <span className="ml-auto text-2xs text-muted num" suppressHydrationWarning>
            {time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · {(turn.duration_ms / 1000).toFixed(1)}s
          </span>
        </header>
        <div className="space-y-5 px-4 py-4 sm:px-5">
          {turn.status === 'answered' && <Answered turn={turn} onAsk={onAsk} busy={busy} />}
          {turn.status === 'clarification' && turn.clarification && (
            <div>
              <p className="font-medium">{turn.clarification.question}</p>
              {turn.interpretation && <p className="mt-1 text-sm text-muted">{turn.interpretation}</p>}
              {turn.clarification.options.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {turn.clarification.options.map((o) => <SuggestionChip key={o} disabled={busy} onClick={() => onAsk(o)}>{o}</SuggestionChip>)}
                </div>
              )}
            </div>
          )}
          {turn.status === 'unsupported' && (
            <div>
              <p>{turn.interpretation || 'This question cannot be answered from the columns in this dataset.'}</p>
              <p className="mt-3 text-xs font-medium text-muted">Questions this dataset can answer</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {buildSuggestions(info).slice(0, 4).map((q) => <SuggestionChip key={q} disabled={busy} onClick={() => onAsk(q)}>{q}</SuggestionChip>)}
              </div>
            </div>
          )}
          {turn.status === 'error' && turn.error && (
            <Alert tone="danger" title="The analysis did not complete" action={<Button size="sm" disabled={busy} onClick={() => onAsk(turn.question)} icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}>Retry</Button>}>
              {turn.error.message}
            </Alert>
          )}
        </div>
      </div>
    </article>
  );
}

function Answered({ turn, onAsk, busy }: { turn: AnalysisTurn; onAsk: (q: string) => void; busy: boolean }) {
  const n = turn.narrative;
  const caveats = [...turn.warnings, ...(n?.caveats ?? [])].filter((c, i, all) => all.indexOf(c) === i);
  const tabs = [
    ...(turn.result ? [{ id: 'table', label: 'Table', content: <ResultTable result={turn.result} fileName={turn.question} /> }] : []),
    ...(turn.sql ? [{ id: 'sql', label: 'SQL', content: <CodeBlock code={turn.sql} label="SQL" /> }] : []),
    { id: 'method', label: 'How this was answered', content: <Method turn={turn} /> },
  ];

  return (
    <>
      {n && (
        <section aria-label="AI interpretation" className="rounded-md border border-ai/20 bg-ai-soft/40 p-4">
          <Badge tone="ai" icon={<Sparkles className="h-3 w-3" aria-hidden />}>AI interpretation</Badge>
          <p className="mt-2 text-lg font-semibold leading-snug">{n.headline}</p>
          <p className="mt-1.5 text-[15px]">{n.summary}</p>
          {n.insights.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {n.insights.map((ins, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ai" aria-hidden />
                  <span>{ins.text}{ins.columns.length > 0 && <span className="ml-1.5 text-2xs text-muted">({ins.columns.join(', ')})</span>}</span>
                </li>
              ))}
            </ul>
          )}
          {turn.grounding && <GroundingNote grounding={turn.grounding} />}
        </section>
      )}

      <section aria-label="Calculated result">
        <Badge tone="success" icon={<Calculator className="h-3 w-3" aria-hidden />}>Calculated from your data</Badge>
        <p className={cx('mt-2', n ? 'text-sm text-muted' : 'text-[15px] font-medium')}>{turn.computed_summary}</p>
        {turn.facts.length > 0 && (
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {turn.facts.slice(0, 8).map((f) => (
              <div key={f.id} className="rounded-md border border-line bg-sunken/50 px-3 py-2">
                <dt className="truncate text-2xs font-medium text-muted" title={f.label}>{f.label}</dt>
                <dd className="mt-0.5 truncate text-base font-semibold num" title={f.display}>{f.display}</dd>
                {f.detail && <dd className="truncate text-2xs text-muted" title={f.detail}>{f.detail}</dd>}
              </div>
            ))}
          </dl>
        )}
        {turn.narrative_note && !n && <p className="mt-3 flex gap-1.5 text-xs text-muted"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{turn.narrative_note}</p>}
      </section>

      {turn.chart && <ChartCard spec={turn.chart} />}

      {caveats.length > 0 && (
        <section aria-label="Caveats" className="rounded-md border border-warning/25 bg-warning-soft/60 px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-warning"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />Keep in mind</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm">{caveats.map((c) => <li key={c}>{c}</li>)}</ul>
        </section>
      )}

      <Tabs items={tabs} label="Answer details" />

      {n && n.follow_ups.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted">Suggested follow-ups</p>
          <div className="mt-2 flex flex-wrap gap-2">{n.follow_ups.map((q) => <SuggestionChip key={q} disabled={busy} onClick={() => onAsk(q)}>{q}</SuggestionChip>)}</div>
        </div>
      )}
    </>
  );
}

function GroundingNote({ grounding }: { grounding: NonNullable<AnalysisTurn['grounding']> }) {
  if (grounding.unverified.length) {
    return (
      <p className="mt-3 flex gap-1.5 text-xs text-warning">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{grounding.unverified.length === 1 ? 'One figure' : `${grounding.unverified.length} figures`} in this interpretation could not be matched to computed results: <strong>{grounding.unverified.join(', ')}</strong>. Rely on the calculated values below.</span>
      </p>
    );
  }
  return (
    <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
      <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden />
      {grounding.checked ? `All ${grounding.checked} figure${grounding.checked === 1 ? '' : 's'} match the calculated results.` : 'No figures to check in this interpretation.'}
    </p>
  );
}

function Method({ turn }: { turn: AnalysisTurn }) {
  const v = turn.verification;
  return (
    <div className="space-y-4 text-sm">
      <Row label="Interpreted as">{turn.interpretation || '—'}</Row>
      {turn.assumptions.length > 0 && <Row label="Assumptions"><ul className="list-disc space-y-0.5 pl-4">{turn.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></Row>}
      {turn.columns_used.length > 0 && (
        <Row label="Columns used"><div className="flex flex-wrap gap-1">{turn.columns_used.map((c) => <code key={c} className="rounded border border-line bg-sunken px-1.5 text-xs">{c}</code>)}</div></Row>
      )}
      {v && (
        <Row label="Independent check">
          <span className={cx('inline-flex items-start gap-1.5', v.status === 'match' ? 'text-success' : v.status === 'mismatch' ? 'text-danger' : 'text-muted')}>
            {v.status === 'match' ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : v.status === 'mismatch' ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
            {v.detail}
          </span>
        </Row>
      )}
      <Row label="Steps">
        <ol className="space-y-1">
          {turn.trace.map((t, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span className={cx('font-medium', t.status === 'error' ? 'text-danger' : t.status === 'skipped' ? 'text-muted' : 'text-fg')}>{t.step.replace(/_/g, ' ')}</span>
              <span className="text-muted">{t.detail}</span>
              <span className="ml-auto text-subtle num">{t.duration_ms} ms</span>
            </li>
          ))}
        </ol>
      </Row>
      {turn.spec && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-muted hover:text-fg">Analysis specification (JSON)</summary>
          <div className="mt-2"><CodeBlock code={JSON.stringify(turn.spec, null, 2)} label="JSON" /></div>
        </details>
      )}
      <p className="flex items-center gap-1.5 text-2xs text-muted"><Database className="h-3 w-3" aria-hidden />Numbers come from read-only SQL and deterministic statistics. {turn.planner.kind === 'anthropic' ? 'Claude chose the analysis and wrote the interpretation; it did not calculate the figures.' : 'No AI was involved in this answer.'}</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="relative">
      <pre className="max-h-80 overflow-auto rounded-md border border-line bg-sunken p-3 pr-20 text-[12.5px] leading-5 scroll-thin"><code>{code}</code></pre>
      <Button size="sm" variant="secondary" className="absolute right-2 top-2" onClick={copy} icon={copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />} aria-label={`Copy ${label}`}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

export function SuggestionChip({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-left text-[13px] text-fg transition-colors hover:border-primary/50 hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-50">
      {children}
    </button>
  );
}
