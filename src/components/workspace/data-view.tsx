'use client';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Filter as FilterIcon, Plus, Search, SearchX, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/client/api';
import { formatInteger, formatNumber } from '@/lib/format';
import type { ColumnProfile, ColumnType, RowsPage } from '@/lib/types';
import type { Filter } from '@/lib/analysis/spec';
import { Alert, Button, cx, EmptyState, IconButton, Spinner } from '../ui';
import { typeIcon } from './column-meta';
import { useDataset } from './context';

type Op = Filter['op'];
const OPS: Record<'numeric' | 'date' | 'text', { op: Op; label: string }[]> = {
  numeric: [{ op: 'eq', label: '=' }, { op: 'neq', label: '≠' }, { op: 'gt', label: '>' }, { op: 'gte', label: '≥' }, { op: 'lt', label: '<' }, { op: 'lte', label: '≤' }, { op: 'is_null', label: 'is missing' }, { op: 'not_null', label: 'is present' }],
  date: [{ op: 'eq', label: 'on' }, { op: 'gte', label: 'from' }, { op: 'lte', label: 'until' }, { op: 'lt', label: 'before' }, { op: 'gt', label: 'after' }, { op: 'is_null', label: 'is missing' }, { op: 'not_null', label: 'is present' }],
  text: [{ op: 'eq', label: 'is' }, { op: 'neq', label: 'is not' }, { op: 'contains', label: 'contains' }, { op: 'starts_with', label: 'starts with' }, { op: 'is_null', label: 'is missing' }, { op: 'not_null', label: 'is present' }],
};
const opGroup = (t: ColumnType) => (t === 'numeric' ? 'numeric' : t === 'date' ? 'date' : 'text');
const opLabel = (t: ColumnType, op: Op) => OPS[opGroup(t)].find((o) => o.op === op)?.label ?? op;
const needsValue = (op: Op) => op !== 'is_null' && op !== 'not_null';

export function DataView() {
  const { info, id } = useDataset();
  const params = useSearchParams();
  const types = useMemo(() => new Map(info.columns.map((c) => [c.name, c.type])), [info]);

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sort, setSort] = useState<{ column: string; dir: 'asc' | 'desc' } | null>(() => {
    const s = params.get('sort');
    return s && types.has(s) ? { column: s, dir: params.get('dir') === 'desc' ? 'desc' : 'asc' } : null;
  });
  const [filters, setFilters] = useState<Filter[]>(() => {
    const m = params.get('missing');
    return m && types.has(m) ? [{ column: m, op: 'is_null', value: null, values: null }] : [];
  });
  const [pageSize, setPageSize] = useState(50);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<RowsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setOffset(0); }, [debounced, sort, filters, pageSize]);

  useEffect(() => {
    const controller = new AbortController();
    const qs = new URLSearchParams({ offset: String(offset), limit: String(pageSize) });
    if (sort) { qs.set('sort', sort.column); qs.set('dir', sort.dir); }
    if (debounced) qs.set('q', debounced);
    if (filters.length) qs.set('filters', JSON.stringify(filters));
    setLoading(true);
    setError(null);
    api.rows(id, qs, controller.signal)
      .then((p) => { setPage(p); setLoading(false); })
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(e instanceof ApiError ? e.message : 'Rows could not be loaded.');
        setLoading(false);
      });
    return () => controller.abort();
  }, [id, offset, pageSize, sort, debounced, filters, reloadKey]);

  const cycleSort = (column: string) => setSort((s) => (s?.column !== column ? { column, dir: 'asc' } : s.dir === 'asc' ? { column, dir: 'desc' } : null));
  const total = page?.total ?? 0;
  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + pageSize, total);

  return (
    <div className="flex h-[calc(100dvh-6.5rem)] flex-col p-4 sm:p-6 lg:h-[calc(100dvh-3.5rem)]">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search all text columns…" aria-label="Search rows"
            className="h-9 w-full rounded-md border border-line-strong bg-surface pl-9 pr-3 text-sm placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
        </div>
        <Button size="sm" onClick={() => setShowBuilder((v) => !v)} aria-expanded={showBuilder} icon={<FilterIcon className="h-3.5 w-3.5" aria-hidden />}>Filter</Button>
        {filters.map((f, i) => (
          <span key={i} className="inline-flex h-8 items-center gap-1 rounded-full border border-primary/25 bg-primary-soft pl-3 pr-1 text-xs text-primary">
            <span className="font-medium">{f.column}</span> {opLabel(types.get(f.column)!, f.op)} {needsValue(f.op) && <span className="font-medium">{String(f.value)}</span>}
            <IconButton size="sm" label={`Remove filter on ${f.column}`} className="h-6 w-6 text-primary hover:bg-primary/10" onClick={() => setFilters((fs) => fs.filter((_, j) => j !== i))}>
              <X className="h-3 w-3" aria-hidden />
            </IconButton>
          </span>
        ))}
        {(filters.length > 0 || search) && <Button size="sm" variant="ghost" onClick={() => { setFilters([]); setSearch(''); }}>Clear all</Button>}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted">
          {loading && page && <Spinner />}
          <span className="num" aria-live="polite">{page ? `${formatInteger(total)} ${total === 1 ? 'row' : 'rows'}${total !== info.row_count ? ` of ${formatInteger(info.row_count)}` : ''}` : ''}</span>
        </div>
      </div>

      {showBuilder && <FilterBuilder columns={info.columns} onAdd={(f) => { setFilters((fs) => [...fs, f]); setShowBuilder(false); }} onCancel={() => setShowBuilder(false)} />}
      {error && <Alert tone="danger" className="mt-3" title="Could not load rows" action={<Button size="sm" onClick={() => setReloadKey((k) => k + 1)}>Retry</Button>}>{error}</Alert>}

      <div className="card mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className={cx('min-h-0 flex-1 overflow-auto scroll-thin', loading && page && 'opacity-60 transition-opacity')} tabIndex={0} aria-label="Dataset rows">
          {!page && loading ? (
            <div className="space-y-2 p-4" aria-busy="true">{Array.from({ length: 10 }, (_, i) => <div key={i} className="skeleton h-6" />)}</div>
          ) : page && page.rows.length === 0 ? (
            <EmptyState icon={<SearchX />} title="No rows match" action={<Button size="sm" onClick={() => { setFilters([]); setSearch(''); }}>Clear search and filters</Button>}>
              Try a different search term or remove a filter.
            </EmptyState>
          ) : page && (
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr>
                  <th scope="col" className="sticky left-0 z-10 w-12 border-b border-line bg-surface px-3 py-2 text-right text-2xs font-medium text-subtle">#</th>
                  {info.columns.map((c) => {
                    const Icon = typeIcon(c.type);
                    const active = sort?.column === c.name;
                    return (
                      <th key={c.name} scope="col" aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                        className={cx('whitespace-nowrap border-b border-line px-1 py-1 font-medium', c.type === 'numeric' ? 'text-right' : 'text-left')}>
                        <button type="button" onClick={() => cycleSort(c.name)}
                          className={cx('inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs hover:bg-sunken', active ? 'text-fg' : 'text-muted', c.type === 'numeric' && 'flex-row-reverse')}>
                          <Icon className="h-3 w-3 text-subtle" aria-hidden />
                          {c.name}
                          {active ? (sort!.dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />) : <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden />}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {page.rows.map((row, i) => (
                  <tr key={offset + i} className="hover:bg-sunken/60">
                    <td className="sticky left-0 border-b border-line bg-surface px-3 py-1.5 text-right text-2xs text-subtle num">{formatInteger(offset + i + 1)}</td>
                    {info.columns.map((c) => <Cell key={c.name} value={row[c.name]} type={c.type} />)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs text-muted">
          <label className="flex items-center gap-2">
            Rows per page
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="h-7 rounded border border-line-strong bg-surface px-1.5 text-xs">
              {[25, 50, 100, 250].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <span className="num">{total ? `${formatInteger(from)}–${formatInteger(to)} of ${formatInteger(total)}` : '0 rows'}</span>
            <IconButton size="sm" label="Previous page" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - pageSize))}><ChevronLeft className="h-4 w-4" aria-hidden /></IconButton>
            <IconButton size="sm" label="Next page" disabled={to >= total || loading} onClick={() => setOffset(offset + pageSize)}><ChevronRight className="h-4 w-4" aria-hidden /></IconButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function Cell({ value, type }: { value: unknown; type: ColumnType }) {
  const missing = value === null || value === undefined || value === '';
  return (
    <td className={cx('max-w-[280px] truncate whitespace-nowrap border-b border-line px-3 py-1.5', type === 'numeric' && 'text-right num')} title={missing ? 'Missing' : String(value)}>
      {missing ? <span className="text-subtle" aria-label="missing">—</span> : type === 'numeric' ? formatNumber(Number(value), 4) : String(value)}
    </td>
  );
}

function FilterBuilder({ columns, onAdd, onCancel }: { columns: ColumnProfile[]; onAdd: (f: Filter) => void; onCancel: () => void }) {
  const [column, setColumn] = useState(columns[0]?.name ?? '');
  const col = columns.find((c) => c.name === column);
  const ops = OPS[opGroup(col?.type ?? 'text')];
  const [op, setOp] = useState<Op>(ops[0].op);
  const [value, setValue] = useState('');
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => { setOp(OPS[opGroup(col?.type ?? 'text')][0].op); setValue(''); }, [column, col?.type]);
  const valid = !needsValue(op) || value.trim() !== '';
  const control = 'h-9 rounded-md border border-line-strong bg-surface px-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';
  const listId = `values-${column}`;

  return (
    <form className="card mt-3 flex flex-wrap items-end gap-2 p-3" onSubmit={(e) => { e.preventDefault(); if (valid) onAdd({ column, op, value: needsValue(op) ? value.trim() : null, values: null }); }}>
      <label className="flex flex-col gap-1 text-xs text-muted">Column
        <select ref={first} value={column} onChange={(e) => setColumn(e.target.value)} className={control}>
          {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">Condition
        <select value={op} onChange={(e) => setOp(e.target.value as Op)} className={control}>
          {ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
        </select>
      </label>
      {needsValue(op) && (
        <label className="flex flex-col gap-1 text-xs text-muted">Value
          <input value={value} onChange={(e) => setValue(e.target.value)} list={listId} className={cx(control, 'w-48')}
            type={col?.type === 'date' ? 'date' : col?.type === 'numeric' ? 'number' : 'text'} step="any" required />
          {col && col.top_values.length > 0 && col.type !== 'numeric' && (
            <datalist id={listId}>{col.top_values.map((v) => <option key={v.value} value={v.value} />)}</datalist>
          )}
        </label>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="md" variant="primary" disabled={!valid} icon={<Plus className="h-4 w-4" aria-hidden />}>Add filter</Button>
        <Button size="md" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
