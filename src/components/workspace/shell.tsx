'use client';
import { Code2, FileX2, LayoutDashboard, Loader2, MessageSquareText, Plus, Table2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, forgetDataset } from '@/lib/client/api';
import { formatInteger } from '@/lib/format';
import { AiStatusBadge, Brand, ThemeToggle } from '../app/chrome';
import { relativeTime } from '../import/time';
import { Badge, Button, ConfirmDialog, cx, EmptyState } from '../ui';
import { useWorkspace } from './context';

const NAV = [
  { href: '', label: 'Overview', icon: LayoutDashboard },
  { href: '/data', label: 'Data', icon: Table2 },
  { href: '/ask', label: 'Ask', icon: MessageSquareText },
  { href: '/sql', label: 'SQL', icon: Code2 },
] as const;

const SOURCE_LABEL = { csv: 'CSV', excel: 'Excel', demo: 'Demo' } as const;

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const { id, info, loadError, pending, turns } = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const base = `/datasets/${id}`;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);

  const isActive = (href: string) => (href ? pathname.startsWith(`${base}${href}`) : pathname === base);
  const current = NAV.find((n) => isActive(n.href)) ?? NAV[0];

  const remove = async () => {
    setDeleting(true);
    try { await api.deleteDataset(id); } catch { /* already gone is fine */ }
    forgetDataset(id);
    router.push('/');
  };

  if (loadError) {
    return (
      <div className="flex min-h-[100dvh] flex-col">
        <header className="flex h-14 items-center justify-between border-b border-line bg-surface px-4"><Brand /><ThemeToggle /></header>
        <main id="main" className="flex flex-1 items-center justify-center p-6">
          <EmptyState icon={<FileX2 />} title={loadError.status === 404 ? 'This dataset is no longer available' : 'The dataset could not be loaded'}
            action={<Link href="/" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg">Import a dataset</Link>}>
            {loadError.message}
          </EmptyState>
        </main>
      </div>
    );
  }

  const navItem = (n: (typeof NAV)[number], mobile = false) => {
    const active = isActive(n.href);
    const Icon = n.icon;
    return (
      <Link key={n.href} href={`${base}${n.href}`} aria-current={active ? 'page' : undefined}
        className={cx(
          'flex items-center gap-2.5 rounded-md text-sm font-medium transition-colors',
          mobile ? 'h-9 shrink-0 px-3' : 'h-9 px-2.5',
          active ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-sunken hover:text-fg',
        )}>
        <Icon className="h-4 w-4" aria-hidden />
        {n.label}
        {n.href === '/ask' && (pending
          ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" aria-label="Analysis running" />
          : turns.length > 0 && !mobile && <span className="ml-auto text-2xs text-muted num">{turns.length}</span>)}
      </Link>
    );
  };

  return (
    <div className="flex min-h-[100dvh]">
      <aside className="sticky top-0 hidden h-[100dvh] w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex" aria-label="Dataset navigation">
        <div className="flex h-14 items-center px-4"><Brand /></div>
        <div className="mx-3 rounded-md border border-line bg-sunken/60 p-3">
          {info ? (
            <>
              <p className="truncate text-sm font-semibold" title={info.name}>{info.name}</p>
              <p className="mt-0.5 text-xs text-muted num">{formatInteger(info.row_count)} rows · {info.column_count} columns</p>
              <Badge className="mt-2">{SOURCE_LABEL[info.source]}{info.sheet ? ` · ${info.sheet}` : ''}</Badge>
            </>
          ) : (
            <div className="space-y-2" aria-hidden><div className="skeleton h-4 w-3/4" /><div className="skeleton h-3 w-1/2" /></div>
          )}
        </div>
        <nav className="mt-4 flex flex-col gap-0.5 px-3" aria-label="Workspace">{NAV.map((n) => navItem(n))}</nav>
        <div className="mt-auto space-y-3 border-t border-line p-3">
          {info && <p className="px-1 text-xs text-muted" suppressHydrationWarning>Deleted automatically {relativeTime(info.expires_at)}.</p>}
          <div className="flex gap-2">
            <Link href="/" className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-line-strong text-[13px] font-medium hover:bg-sunken">
              <Plus className="h-3.5 w-3.5" aria-hidden /> New
            </Link>
            <Button size="sm" variant="danger" className="flex-1" onClick={() => setConfirmDelete(true)} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}>Delete</Button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <div className="lg:hidden"><Brand compact /></div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold lg:hidden">{info?.name ?? 'Loading…'}</p>
              <h1 className="hidden text-sm font-semibold lg:block">{current.label}</h1>
            </div>
            <AiStatusBadge />
            <ThemeToggle />
            <div className="lg:hidden">
              <Button size="sm" variant="ghost" className="w-8 px-0" aria-label="Delete dataset" title="Delete dataset" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" aria-hidden /></Button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-2 lg:hidden scroll-thin" aria-label="Workspace">{NAV.map((n) => navItem(n, true))}</nav>
        </header>
        <main id="main" className="min-w-0 flex-1">{info ? children : <WorkspaceSkeleton />}</main>
      </div>

      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={remove} busy={deleting}
        title="Delete this dataset?" confirmLabel="Delete permanently">
        <strong className="text-fg">{info?.name}</strong> and its saved analyses will be removed from the server. This cannot be undone.
      </ConfirmDialog>
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6" aria-busy="true" aria-label="Loading dataset">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-20" />)}</div>
      <div className="skeleton h-64" />
    </div>
  );
}
