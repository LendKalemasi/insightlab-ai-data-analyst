import type { AggregateSpec, Filter, Measure, TimeGrain } from '../analysis/spec';
import { SAFE_IDENTIFIER } from '../ingest/headers';
import type { ColumnType } from '../types';

/**
 * SQL text generation. Column names are validated against the identifier
 * pattern enforced at import and double-quoted; every value is a bound `?`
 * parameter. This module is the only place SQL text is assembled.
 */

export type SqlParam = string | number;
export interface CompiledSql { sql: string; params: SqlParam[] }

export function quoteIdent(name: string): string {
  if (name !== 'dataset' && !SAFE_IDENTIFIER.test(name)) throw new Error(`Unsafe identifier rejected: ${name}`);
  return `"${name.replace(/"/g, '""')}"`;
}

export function grainExpr(column: string, grain: TimeGrain | null): string {
  const c = quoteIdent(column);
  switch (grain) {
    case 'day': return `substr(${c}, 1, 10)`;
    case 'week': return `strftime('%Y-W%W', substr(${c}, 1, 10))`;
    case 'month': return `substr(${c}, 1, 7)`;
    case 'quarter': return `(substr(${c}, 1, 4) || '-Q' || ((CAST(substr(${c}, 6, 2) AS INTEGER) + 2) / 3))`;
    case 'year': return `substr(${c}, 1, 4)`;
    default: return c;
  }
}

export const dimensionAlias = (d: { column: string; time_grain: TimeGrain | null }) =>
  d.time_grain ? `${d.column}_${d.time_grain}` : d.column;

export function measureAlias(m: Measure): string {
  if (m.agg === 'count' && !m.column) return 'row_count';
  return `${m.agg}_${m.column}`;
}

function measureExpr(m: Measure): string {
  if (m.agg === 'count') return m.column ? `COUNT(${quoteIdent(m.column)})` : 'COUNT(*)';
  if (m.agg === 'count_distinct') return `COUNT(DISTINCT ${quoteIdent(m.column!)})`;
  return `${m.agg.toUpperCase()}(${quoteIdent(m.column!)})`;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Compiles filters to a WHERE clause. Text equality is case-insensitive so
 * "north" matches "North". "Not equal" keeps rows where the value is missing,
 * matching pandas semantics so the cross-check agrees.
 */
export function compileFilters(filters: Filter[], types: Map<string, ColumnType>): CompiledSql {
  const clauses: string[] = [];
  const params: SqlParam[] = [];
  for (const f of filters) {
    const type = types.get(f.column);
    const text = type !== 'numeric';
    const isDateOnly = (v: unknown) => type === 'date' && typeof v === 'string' && v.length === 10;
    const col = (v?: unknown) => isDateOnly(v) ? `substr(${quoteIdent(f.column)}, 1, 10)` : quoteIdent(f.column);
    const nocase = text && type !== 'date' ? ' COLLATE NOCASE' : '';
    const value = f.value as SqlParam;
    const list = (f.values ?? []) as SqlParam[];
    switch (f.op) {
      case 'eq': clauses.push(`${col(value)}${nocase} = ?`); params.push(value); break;
      case 'neq': clauses.push(`(${col(value)} IS NULL OR ${col(value)}${nocase} <> ?)`); params.push(value); break;
      case 'gt': clauses.push(`${col(value)} > ?`); params.push(value); break;
      case 'gte': clauses.push(`${col(value)} >= ?`); params.push(value); break;
      case 'lt': clauses.push(`${col(value)} < ?`); params.push(value); break;
      case 'lte': clauses.push(`${col(value)} <= ?`); params.push(value); break;
      case 'between':
        clauses.push(`${col(list[0])} BETWEEN ? AND ?`); params.push(list[0], list[1]); break;
      case 'in':
        clauses.push(`${quoteIdent(f.column)}${nocase} IN (${list.map(() => '?').join(', ')})`); params.push(...list); break;
      case 'not_in':
        clauses.push(`(${quoteIdent(f.column)} IS NULL OR ${quoteIdent(f.column)}${nocase} NOT IN (${list.map(() => '?').join(', ')}))`); params.push(...list); break;
      case 'contains':
        clauses.push(`${quoteIdent(f.column)} LIKE ? ESCAPE '\\'`); params.push(`%${escapeLike(String(value))}%`); break;
      case 'starts_with':
        clauses.push(`${quoteIdent(f.column)} LIKE ? ESCAPE '\\'`); params.push(`${escapeLike(String(value))}%`); break;
      case 'is_null': clauses.push(`${quoteIdent(f.column)} IS NULL`); break;
      case 'not_null': clauses.push(`${quoteIdent(f.column)} IS NOT NULL`); break;
    }
  }
  return { sql: clauses.length ? `WHERE ${clauses.join('\n  AND ')}` : '', params };
}

export function buildAggregateSql(spec: AggregateSpec, types: Map<string, ColumnType>, rowCap: number): CompiledSql {
  const where = compileFilters(spec.filters, types);
  const dims = spec.dimensions.map((d) => `${grainExpr(d.column, d.time_grain)} AS ${quoteIdent(dimensionAlias(d))}`);
  const measures = spec.measures.map((m) => `${measureExpr(m)} AS ${quoteIdent(measureAlias(m))}`);
  const lines = [`SELECT ${[...dims, ...measures].join(',\n       ')}`, 'FROM dataset'];
  if (where.sql) lines.push(where.sql);
  if (dims.length) {
    lines.push(`GROUP BY ${spec.dimensions.map((_, i) => i + 1).join(', ')}`);
    lines.push(`ORDER BY ${orderBy(spec)}`);
    const limit = Math.min(spec.limit ?? rowCap, rowCap);
    // One extra row reveals whether the result was cut off.
    lines.push(`LIMIT ${limit + 1}`);
  }
  return { sql: lines.join('\n'), params: where.params };
}

function orderBy(spec: AggregateSpec): string {
  const dimAliases = spec.dimensions.map((d) => quoteIdent(dimensionAlias(d)));
  const tieBreak = dimAliases.map((a) => `${a} ASC`);
  const s = spec.sort;
  if (s) {
    const target = s.by === 'measure' ? quoteIdent(measureAlias(spec.measures[s.index])) : dimAliases[s.index];
    return [`${target} ${s.direction.toUpperCase()}`, ...tieBreak.filter((t) => !t.startsWith(target))].join(', ');
  }
  const timeIndex = spec.dimensions.findIndex((d) => d.time_grain);
  if (timeIndex >= 0) return tieBreak.join(', ');
  return [`${quoteIdent(measureAlias(spec.measures[0]))} DESC`, ...tieBreak].join(', ');
}

/** Total of the first measure across all groups (for share-of-total), honouring filters. */
export function buildTotalSql(spec: AggregateSpec, types: Map<string, ColumnType>): CompiledSql {
  const where = compileFilters(spec.filters, types);
  return { sql: `SELECT ${measureExpr(spec.measures[0])} AS total FROM dataset ${where.sql}`.trim(), params: where.params };
}

/** Number of groups the aggregate produces before any LIMIT. */
export function buildGroupCountSql(spec: AggregateSpec, types: Map<string, ColumnType>): CompiledSql {
  const where = compileFilters(spec.filters, types);
  const dims = spec.dimensions.map((d) => grainExpr(d.column, d.time_grain));
  return {
    sql: `SELECT COUNT(*) AS n FROM (SELECT ${dims.join(', ')} FROM dataset ${where.sql} GROUP BY ${dims.map((_, i) => i + 1).join(', ')})`,
    params: where.params,
  };
}

export function buildCountSql(filters: Filter[], types: Map<string, ColumnType>, column?: string): CompiledSql {
  const where = compileFilters(filters, types);
  const present = column ? `, COUNT(${quoteIdent(column)}) AS present` : '';
  return { sql: `SELECT COUNT(*) AS total${present} FROM dataset ${where.sql}`.trim(), params: where.params };
}

/** Most frequent values of a column (dates bucketed by month), largest first. */
export function buildValueCountsSql(column: string, filters: Filter[], types: Map<string, ColumnType>, limit: number): CompiledSql {
  const where = compileFilters(filters, types);
  const isDate = types.get(column) === 'date';
  const expr = isDate ? grainExpr(column, 'month') : quoteIdent(column);
  const lines = [`SELECT ${expr} AS value, COUNT(*) AS count`, 'FROM dataset'];
  if (where.sql) lines.push(where.sql);
  lines.push('GROUP BY 1', isDate ? 'ORDER BY 1' : 'ORDER BY 2 DESC, 1', `LIMIT ${limit}`);
  return { sql: lines.join('\n'), params: where.params };
}

/** SELECT of raw columns for statistics computed in TypeScript. */
export function buildSelectSql(columns: string[], filters: Filter[], types: Map<string, ColumnType>, opts: { notNull?: string[]; orderBy?: { column: string; direction: 'asc' | 'desc' } | null; limit?: number } = {}): CompiledSql {
  const allFilters: Filter[] = [...filters, ...(opts.notNull ?? []).map((column) => ({ column, op: 'not_null' as const, value: null, values: null }))];
  const where = compileFilters(allFilters, types);
  const lines = [`SELECT ${columns.map(quoteIdent).join(', ')}`, 'FROM dataset'];
  if (where.sql) lines.push(where.sql);
  if (opts.orderBy) lines.push(`ORDER BY ${quoteIdent(opts.orderBy.column)} ${opts.orderBy.direction.toUpperCase()} NULLS LAST`);
  if (opts.limit) lines.push(`LIMIT ${opts.limit}`);
  return { sql: lines.join('\n'), params: where.params };
}

/** Renders SQL with parameters inlined, for display only — never executed. */
export function displaySql({ sql, params }: CompiledSql): string {
  let i = 0;
  return sql.replace(/\?/g, () => {
    const p = params[i++];
    return typeof p === 'number' ? String(p) : `'${String(p).replace(/'/g, "''")}'`;
  });
}
