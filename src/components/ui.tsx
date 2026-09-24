'use client';
import { useState } from 'react';
import type { TraceEvent } from '@/lib/types';

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`panel p-5 ${className}`}>{children}</section>;
}

export function Tabs({ tabs }: { tabs: { label: string; content: React.ReactNode }[] }) {
  const [active, setActive] = useState(0);
  return (
    <div>
      <div role="tablist" aria-label="Analysis details" className="flex flex-wrap gap-1 border-b border-line">
        {tabs.map((tab, index) => (
          <button key={tab.label} role="tab" aria-selected={index === active} aria-controls={`tab-panel-${index}`} id={`tab-${index}`} onClick={() => setActive(index)}
            className={`min-h-11 border-b-2 px-3 py-2 text-sm font-medium ${index === active ? 'border-cobalt text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
            {tab.label}
          </button>
        ))}
      </div>
      <div className="pt-4" role="tabpanel" id={`tab-panel-${active}`} aria-labelledby={`tab-${active}`}>{tabs[active]?.content}</div>
    </div>
  );
}

export function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <button onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        aria-label={`Copy ${language} code`} className="absolute right-2 top-2 z-10 min-h-11 rounded-control border border-line bg-surface px-3 py-2 font-mono text-meta text-muted hover:text-ink">
        {copied ? 'Copied' : `Copy ${language}`}
      </button>
      <pre className="code-block max-h-80 overflow-auto rounded-control border border-line bg-ink p-4 pr-28 font-mono text-code leading-relaxed text-surface">{code}</pre>
    </div>
  );
}

export function DataTable({ columns, rows, max = 100 }: { columns: string[]; rows: Record<string, unknown>[]; max?: number }) {
  if (!rows.length) return <p className="text-body text-muted">No rows returned.</p>;
  return (
    <div className="data-table-wrap max-h-80 overflow-auto rounded-control border border-line" tabIndex={0} aria-label="Scrollable data table">
      <table className="data-table w-full">
        <thead className="sticky top-0 z-[1] bg-surface2 text-left text-meta text-muted">
          <tr>{columns.map((column) => <th key={column} className="border-b border-line px-3 py-2 font-medium">{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, max).map((row, index) => (
            <tr key={index} className="border-b border-line last:border-0">
              {columns.map((column) => <td key={column} className="whitespace-nowrap px-3 py-2 text-ink">{String(row[column] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Skeleton({ label }: { label: string }) {
  return (
    <div className="stable-skeleton rounded-panel border border-line bg-surface p-5" role="status" aria-live="polite">
      <p className="text-body font-medium text-ink">{label}</p>
      <div className="mt-5 h-3 w-3/4 animate-pulse rounded bg-surface2" />
      <div className="mt-3 h-3 w-1/2 animate-pulse rounded bg-surface2" />
      <div className="mt-3 h-3 w-2/3 animate-pulse rounded bg-surface2" />
    </div>
  );
}

type ExecutionStage = 'question' | 'plan' | 'query' | 'execute' | 'explain';
const EXECUTION_STAGES: { id: ExecutionStage; label: string }[] = [
  { id: 'question', label: 'Question received' },
  { id: 'plan', label: 'Plan' },
  { id: 'query', label: 'Query / code' },
  { id: 'execute', label: 'Execute' },
  { id: 'explain', label: 'Explain' },
];

function stageFromBusy(activeStage: string | null | undefined): ExecutionStage {
  if (!activeStage) return 'question';
  if (activeStage.includes('Planning')) return 'plan';
  if (activeStage.includes('SQL') || activeStage.includes('Validating')) return 'query';
  if (activeStage.includes('Running')) return 'execute';
  if (activeStage.includes('Checking') || activeStage.includes('Preparing')) return 'explain';
  return 'question';
}

export function ExecutionRail({ activeStage, completed = false, trace = [] }: { activeStage?: string | null; completed?: boolean; trace?: TraceEvent[] }) {
  const active = stageFromBusy(activeStage);
  const activeIndex = completed ? EXECUTION_STAGES.length : EXECUTION_STAGES.findIndex((stage) => stage.id === active);
  const hasError = trace.some((event) => event.status === 'error');
  return (
    <div className="execution-rail rounded-panel p-4" aria-label="Analysis execution progress" aria-live="polite">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-meta font-semibold text-ink">Analysis path</p>
        <p className="font-mono text-[11px] text-muted">{completed ? (hasError ? 'Completed with warnings' : 'Complete') : activeStage ?? 'Waiting'}</p>
      </div>
      <ol className="flex gap-2 overflow-x-auto pb-1">
        {EXECUTION_STAGES.map((stage, index) => {
          const isComplete = index < activeIndex;
          const isActive = !completed && index === activeIndex;
          const isAttention = completed && hasError && stage.id === 'explain';
          return (
            <li key={stage.id} className={`execution-node ${isComplete || completed ? 'is-complete' : ''} ${isActive ? 'is-active' : ''} ${isAttention ? 'is-attention' : ''}`} aria-current={isActive ? 'step' : undefined}>
              <span className="execution-dot-row" aria-hidden="true">
                <span className="execution-dot" />
              </span>
              <span className="execution-label whitespace-nowrap">{stage.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
