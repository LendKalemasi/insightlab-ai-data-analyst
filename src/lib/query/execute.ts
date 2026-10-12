import 'server-only';
import type Database from 'better-sqlite3';
import { config } from '../config';
import { AppError } from '../errors';
import type { DatasetInfo, RowsPage, TableResult } from '../types';
import { compileFilters, quoteIdent, type CompiledSql } from './sql';
import { validateSql } from './validator';
import type { Filter } from '../analysis/spec';

/**
 * better-sqlite3 is synchronous and has no interrupt handle, so the time
 * budget is checked after a statement returns. Work is bounded up front:
 * datasets are capped at MAX_ROWS and result sets at MAX_QUERY_ROWS.
 */
export function runSelect(db: Database.Database, compiled: CompiledSql): { rows: Record<string, unknown>[]; ms: number } {
  // Generated SQL also passes the read-only validator — defence in depth.
  const check = validateSql(compiled.sql, { appendLimit: false });
  if (!check.valid) throw new AppError('SQL_REJECTED', `Generated SQL failed validation: ${check.errors.join(' ')}`, 500);
  const started = performance.now();
  let rows: Record<string, unknown>[];
  try {
    rows = db.prepare(compiled.sql).all(...compiled.params) as Record<string, unknown>[];
  } catch (e) {
    throw new AppError('SQL_FAILED', `The query could not run: ${e instanceof Error ? e.message : 'unknown error'}.`, 400);
  }
  const ms = Math.round(performance.now() - started);
  if (ms > config.queryTimeoutMs) {
    throw new AppError('QUERY_TIMEOUT', `The query took ${ms} ms, over the ${config.queryTimeoutMs} ms budget. Add filters or aggregate further.`, 408, true);
  }
  return { rows, ms };
}

export function toTable(rows: Record<string, unknown>[], cap: number, columns?: string[]): TableResult {
  const truncated = rows.length > cap;
  const kept = truncated ? rows.slice(0, cap) : rows;
  const names = columns ?? (kept[0] ? Object.keys(kept[0]) : []);
  return {
    columns: names.map((name) => ({
      name,
      kind: kept.some((r) => typeof r[name] === 'number') && kept.every((r) => r[name] === null || typeof r[name] === 'number') ? 'number' : 'string',
    })),
    rows: kept,
    row_count: kept.length,
    truncated,
  };
}

/** Runs a user-written query from the SQL editor. */
export function runUserSql(db: Database.Database, sql: string, maxRows: number): TableResult & { sql: string; ms: number; warnings: string[] } {
  const v = validateSql(sql, { maxRows });
  if (!v.valid) throw new AppError('SQL_REJECTED', v.errors.join(' '), 400, false, { errors: v.errors });
  // When we appended the LIMIT, fetch one extra row so truncation is detectable.
  const executable = v.limit_appended ? v.sql.replace(/LIMIT \d+$/, `LIMIT ${maxRows + 1}`) : v.sql;
  const started = performance.now();
  let rows: Record<string, unknown>[];
  let columns: string[];
  try {
    const statement = db.prepare(executable);
    if (!statement.reader) throw new Error('only queries that return rows are allowed');
    columns = statement.columns().map((c) => c.name);
    rows = statement.all() as Record<string, unknown>[];
  } catch (e) {
    throw new AppError('SQL_FAILED', `SQLite error: ${e instanceof Error ? e.message : 'unknown error'}`, 400);
  }
  const ms = Math.round(performance.now() - started);
  if (ms > config.queryTimeoutMs) throw new AppError('QUERY_TIMEOUT', `The query took ${ms} ms, over the ${config.queryTimeoutMs} ms budget.`, 408, true);
  const table = toTable(rows, maxRows, columns);
  const warnings = [...v.warnings];
  if (table.truncated) warnings.push(`Showing the first ${maxRows.toLocaleString()} rows. Add a LIMIT or aggregate to see less.`);
  return { ...table, sql: v.sql, ms, warnings };
}

export interface BrowseParams {
  offset: number; limit: number;
  sort: string | null; direction: 'asc' | 'desc';
  search: string | null;
  filters: Filter[];
}

/** Paged, sorted, searchable rows for the data browser. */
export function browseRows(db: Database.Database, info: DatasetInfo, p: BrowseParams): RowsPage {
  const names = info.columns.map((c) => c.name);
  const types = new Map(info.columns.map((c) => [c.name, c.type]));
  const where = compileFilters(p.filters.filter((f) => types.has(f.column)), types);
  const clauses = where.sql ? [where.sql.replace(/^WHERE /, '')] : [];
  const params = [...where.params];
  if (p.search) {
    const searchable = info.columns.filter((c) => c.type !== 'numeric').map((c) => c.name);
    const numeric = Number(p.search);
    const parts = searchable.map((c) => `${quoteIdent(c)} LIKE ? ESCAPE '\\'`);
    const like = `%${p.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(...searchable.map(() => like));
    if (Number.isFinite(numeric)) {
      const nums = info.columns.filter((c) => c.type === 'numeric').map((c) => c.name);
      parts.push(...nums.map((c) => `${quoteIdent(c)} = ?`));
      params.push(...nums.map(() => numeric));
    }
    if (parts.length) clauses.push(`(${parts.join(' OR ')})`);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM dataset ${whereSql}`).get(...params) as { n: number }).n;
  const order = p.sort && types.has(p.sort)
    ? `ORDER BY ${quoteIdent(p.sort)} ${p.direction === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, rowid`
    : 'ORDER BY rowid';
  const rows = db.prepare(`SELECT ${names.map(quoteIdent).join(', ')} FROM dataset ${whereSql} ${order} LIMIT ? OFFSET ?`)
    .all(...params, p.limit, p.offset) as Record<string, unknown>[];
  return { columns: names, rows, total, offset: p.offset, limit: p.limit };
}
