import type { DataSource } from './index';
import { randomUUID } from 'node:crypto';

/**
 * Server-side session registry. Datasets live in process memory only; nothing
 * is written to disk and nothing is shared between sessions. Entries expire so
 * uploaded data is not retained indefinitely.
 *
 * Production note: replace with Redis or a per-user store before running more
 * than one Node instance. See PORTFOLIO_STATUS.md.
 */
const TTL_MS = 1000 * 60 * 60;
const MAX_SOURCES = 25;
const store = new Map<string, DataSource>();

export function register(ds: DataSource): DataSource {
  sweep();
  if (store.size >= MAX_SOURCES) {
    const oldest = [...store.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) remove(oldest.id);
  }
  store.set(ds.id, ds);
  return ds;
}

export function get(id: string): DataSource | undefined {
  sweep();
  return store.get(id);
}

export function remove(id: string): void {
  store.get(id)?.close();
  store.delete(id);
}

function sweep(): void {
  const now = Date.now();
  for (const [id, ds] of store) if (now - ds.createdAt > TTL_MS) remove(id);
}

export function newId(prefix = 'ds'): string {
  return `${prefix}_${randomUUID()}`;
}
