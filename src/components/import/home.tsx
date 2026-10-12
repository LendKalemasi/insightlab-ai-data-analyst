'use client';
import { ArrowRight, Database, Lock, MessageSquareText, Sparkles, Table2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError, forgetDataset, readRecent, rememberDataset } from '@/lib/client/api';
import type { DatasetSummary } from '@/lib/types';
import { AiStatusBadge, Brand, ThemeToggle, useAppStatus } from '../app/chrome';
import { Alert, Button, ConfirmDialog, IconButton } from '../ui';
import { Dropzone } from './dropzone';
import { relativeTime } from './time';

export function Home() {
  const status = useAppStatus();
  const router = useRouter();
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  const openDemo = async () => {
    setDemoBusy(true); setDemoError(null);
    try {
      const info = await api.loadDemo();
      rememberDataset(info);
      router.push(`/datasets/${info.id}`);
    } catch (e) {
      setDemoError(e instanceof ApiError ? e.message : 'The demo dataset could not be created.');
      setDemoBusy(false);
    }
  };

  return (
    <div className="min-h-[100dvh]">
      <header className="border-b border-line bg-surface/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Brand />
          <div className="flex items-center gap-2"><AiStatusBadge /><ThemeToggle /></div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pt-14">
        <div className="max-w-2xl">
          <p className="eyebrow">New analysis</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Ask your data a question</h1>
          <p className="mt-3 text-muted">
            Import a spreadsheet, check its structure and quality, then ask questions in plain English. Every answer is computed from
            your rows with SQL you can inspect.
          </p>
        </div>

        {status && !status.ai.configured && (
          <Alert tone="info" className="mt-6 max-w-3xl" title="AI is not configured">
            {status.ai.message} Add <code className="rounded bg-surface px-1">ANTHROPIC_API_KEY</code> to <code className="rounded bg-surface px-1">.env</code> and restart to use Claude for planning and explanations.
          </Alert>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Dropzone />
          <aside className="space-y-4">
            <div className="card p-5">
              <p className="font-medium">No file handy?</p>
              <p className="mt-1 text-sm text-muted">Open 820 synthetic e-commerce orders with dates, regions, categories and a few deliberate gaps.</p>
              <Button className="mt-4 w-full" onClick={openDemo} loading={demoBusy} icon={<Database className="h-4 w-4" aria-hidden />}>Open demo dataset</Button>
              {demoError && <p className="mt-2 text-sm text-danger" role="alert">{demoError}</p>}
            </div>
            <ol className="card divide-y divide-line">
              {[
                { icon: Table2, title: 'Explore', text: 'Types, missing values, duplicates and distributions for every column.' },
                { icon: MessageSquareText, title: 'Ask', text: 'Questions become a typed plan; SQL and statistics run on your data.' },
                { icon: Sparkles, title: 'Verify', text: 'Calculated figures, AI interpretation and caveats are labelled separately.' },
              ].map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex gap-3 p-4">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <div><p className="text-sm font-medium">{title}</p><p className="text-sm text-muted">{text}</p></div>
                </li>
              ))}
            </ol>
            <div className="flex gap-3 px-1 text-xs text-muted">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <p>
                Files are stored on this server for {status?.limits.retention_hours ?? 24} hours, then deleted; you can delete them sooner.
                {status?.ai.configured ? ' Column names, summary statistics and common category values are sent to Anthropic to plan answers — never whole rows.' : ' Nothing is sent to an AI service in rule-based mode.'}
              </p>
            </div>
          </aside>
        </div>

        <RecentDatasets />
      </main>
    </div>
  );
}

function RecentDatasets() {
  const [items, setItems] = useState<DatasetSummary[] | null>(null);
  const [pending, setPending] = useState<DatasetSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const recent = readRecent();
    if (!recent.length) { setItems([]); return; }
    api.datasets(recent.map((r) => r.id)).then(({ datasets }) => {
      const alive = new Set(datasets.map((d) => d.id));
      recent.filter((r) => !alive.has(r.id)).forEach((r) => forgetDataset(r.id)); // expired on the server
      const order = new Map(recent.map((r, i) => [r.id, i]));
      setItems(datasets.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)));
    }).catch(() => setItems([]));
  }, []);

  const remove = async () => {
    if (!pending) return;
    setDeleting(true);
    try {
      await api.deleteDataset(pending.id);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) { setDeleting(false); return; }
    }
    forgetDataset(pending.id);
    setItems((list) => list?.filter((d) => d.id !== pending.id) ?? null);
    setPending(null);
    setDeleting(false);
  };

  if (!items?.length) return null;
  return (
    <section className="mt-12" aria-labelledby="recent-heading">
      <h2 id="recent-heading" className="text-sm font-semibold">Recent datasets <span className="font-normal text-muted">· in this browser</span></h2>
      <ul className="card mt-3 divide-y divide-line">
        {items.map((d) => (
          <li key={d.id} className="flex items-center gap-3 px-4 py-3">
            <Database className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
            <Link href={`/datasets/${d.id}`} className="group min-w-0 flex-1 rounded">
              <p className="truncate font-medium group-hover:text-primary">{d.name}</p>
              <p className="text-xs text-muted num">
                {d.row_count.toLocaleString('en-US')} rows · {d.column_count} columns · imported {relativeTime(d.created_at)} · deleted {relativeTime(d.expires_at)}
              </p>
            </Link>
            <IconButton label={`Delete ${d.name}`} size="sm" onClick={() => setPending(d)}><Trash2 className="h-4 w-4" aria-hidden /></IconButton>
            <Link href={`/datasets/${d.id}`} className="hidden h-8 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-primary hover:bg-primary-soft sm:inline-flex">
              Open <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <ConfirmDialog open={!!pending} onClose={() => setPending(null)} onConfirm={remove} busy={deleting}
        title="Delete dataset?" confirmLabel="Delete permanently">
        <strong className="text-fg">{pending?.name}</strong> and its saved analyses will be removed from the server. This cannot be undone.
      </ConfirmDialog>
    </section>
  );
}
