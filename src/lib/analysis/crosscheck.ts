import 'server-only';
import type Database from 'better-sqlite3';
import { config } from '../config';
import { quoteIdent, dimensionAlias, measureAlias } from '../query/sql';
import type { ColumnType, TableResult, Verification } from '../types';
import type { AggregateSpec, Filter } from './spec';

/**
 * Optional independent verification. When PYTHON_SERVICE_URL is configured,
 * an aggregate is recomputed with pandas in the sandboxed analysis service
 * from the same rows, and the two results are compared group by group. The
 * pandas code is generated from the spec, never written by the model.
 */
const MAX_FRAME_ROWS = 200_000;

const py = (s: string | number | boolean) => JSON.stringify(s);

function filterCode(f: Filter, types: Map<string, ColumnType>): string {
  const c = `d[${py(f.column)}]`;
  const type = types.get(f.column);
  const text = type !== 'numeric';
  const dateOnly = (v: unknown) => type === 'date' && typeof v === 'string' && v.length === 10;
  const col = (v: unknown) => (dateOnly(v) ? `${c}.str.slice(0, 10)` : c);
  const lower = (v: unknown) => (text && type !== 'date' ? py(String(v).toLowerCase()) : py(v as string | number));
  const cmp = (v: unknown) => (text && type !== 'date' ? `${c}.astype(str).str.lower()` : col(v));
  const v = f.value as string | number;
  const list = (f.values ?? []) as (string | number)[];
  switch (f.op) {
    case 'eq': return `d = d[${c}.notna() & (${cmp(v)} == ${lower(v)})]`;
    case 'neq': return `d = d[${c}.isna() | (${cmp(v)} != ${lower(v)})]`;
    case 'gt': return `d = d[${col(v)} > ${py(v)}]`;
    case 'gte': return `d = d[${col(v)} >= ${py(v)}]`;
    case 'lt': return `d = d[${col(v)} < ${py(v)}]`;
    case 'lte': return `d = d[${col(v)} <= ${py(v)}]`;
    case 'between': return `d = d[(${col(list[0])} >= ${py(list[0])}) & (${col(list[0])} <= ${py(list[1])})]`;
    case 'in': return `d = d[${c}.notna() & ${text ? `${c}.astype(str).str.lower()` : c}.isin([${list.map((x) => (text ? py(String(x).toLowerCase()) : py(x))).join(', ')}])]`;
    case 'not_in': return `d = d[${c}.isna() | ~${text ? `${c}.astype(str).str.lower()` : c}.isin([${list.map((x) => (text ? py(String(x).toLowerCase()) : py(x))).join(', ')}])]`;
    case 'contains': return `d = d[${c}.fillna("").astype(str).str.contains(${py(String(v))}, case=False, regex=False)]`;
    case 'starts_with': return `d = d[${c}.fillna("").astype(str).str.lower().str.startswith(${py(String(v).toLowerCase())})]`;
    case 'is_null': return `d = d[${c}.isna()]`;
    case 'not_null': return `d = d[${c}.notna()]`;
  }
}

const GRAIN_SLICE: Record<string, number> = { day: 10, month: 7, year: 4 };

export function buildPandas(spec: AggregateSpec, types: Map<string, ColumnType>): string | null {
  if (spec.dimensions.some((d) => d.time_grain && !(d.time_grain in GRAIN_SLICE))) return null; // week/quarter keys are not reproduced
  const lines = ['d = df'];
  for (const f of spec.filters) lines.push(filterCode(f, types));
  const keys = spec.dimensions.map((d, i) => {
    const expr = d.time_grain ? `d[${py(d.column)}].str.slice(0, ${GRAIN_SLICE[d.time_grain]})` : `d[${py(d.column)}]`;
    lines.push(`d = d.assign(_k${i}=${expr})`);
    return `_k${i}`;
  });
  const aggExpr = (m: AggregateSpec['measures'][number], target: string) => {
    if (m.agg === 'count') return m.column ? `${target}[${py(m.column)}].count()` : (keys.length ? `${target}.size()` : 'len(d)');
    if (m.agg === 'count_distinct') return `${target}[${py(m.column!)}].nunique()`;
    if (m.agg === 'sum') return `${target}[${py(m.column!)}].sum(min_count=1)`;
    if (m.agg === 'avg') return `${target}[${py(m.column!)}].mean()`;
    return `${target}[${py(m.column!)}].${m.agg}()`;
  };
  if (keys.length) {
    lines.push(`g = d.groupby([${keys.map(py).join(', ')}], dropna=False)`);
    lines.push(`result = pd.DataFrame({${spec.measures.map((m) => `${py(measureAlias(m))}: ${aggExpr(m, 'g')}`).join(', ')}}).reset_index()`);
    lines.push(`result = result.rename(columns={${keys.map((k, i) => `${py(k)}: ${py(dimensionAlias(spec.dimensions[i]))}`).join(', ')}})`);
  } else {
    lines.push(`result = pd.DataFrame([{${spec.measures.map((m) => `${py(measureAlias(m))}: ${aggExpr(m, 'd')}`).join(', ')}}])`);
  }
  return lines.join('\n');
}

function columnsNeeded(spec: AggregateSpec): string[] {
  return [...new Set([
    ...spec.dimensions.map((d) => d.column),
    ...spec.measures.map((m) => m.column).filter((c): c is string => !!c),
    ...spec.filters.map((f) => f.column),
  ])];
}

/** Remembers whether the service answered /health recently, so a down service costs one fast probe, not a frame export per question. */
let health: { ok: boolean; at: number } | null = null;
async function serviceUp(base: string): Promise<boolean> {
  if (health && Date.now() - health.at < 30_000) return health.ok;
  let ok = false;
  try {
    ok = (await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch { ok = false; }
  health = { ok, at: Date.now() };
  return ok;
}

const keyOf = (row: Record<string, unknown>, keys: string[]) => JSON.stringify(keys.map((k) => (row[k] === null || row[k] === undefined ? null : String(row[k]))));

export async function crossCheck(db: Database.Database, rowCount: number, spec: AggregateSpec, types: Map<string, ColumnType>, sqlResult: TableResult, signal?: AbortSignal): Promise<{ verification: Verification; code: string | null }> {
  if (!config.pythonServiceUrl) return { verification: { status: 'skipped', detail: 'The pandas cross-check is not configured (PYTHON_SERVICE_URL).' }, code: null };
  const code = buildPandas(spec, types);
  if (!code) return { verification: { status: 'skipped', detail: 'Weekly and quarterly groupings are not cross-checked.' }, code: null };
  if (rowCount > MAX_FRAME_ROWS) return { verification: { status: 'skipped', detail: `Datasets over ${MAX_FRAME_ROWS.toLocaleString()} rows are not sent to the cross-check service.` }, code };

  const base = config.pythonServiceUrl.replace(/\/$/, '');
  if (!(await serviceUp(base))) return { verification: { status: 'unavailable', detail: 'The cross-check service is configured but not reachable.' }, code };

  const cols = columnsNeeded(spec);
  const frameSql = cols.length ? `SELECT ${cols.map(quoteIdent).join(', ')} FROM dataset` : 'SELECT 1 AS _one FROM dataset';
  const rows = db.prepare(frameSql).all() as Record<string, unknown>[];
  const timeout = AbortSignal.timeout(config.pythonTimeoutMs + 5000);
  let body: { success?: boolean; stderr?: string; result?: { rows: Record<string, unknown>[] } | null };
  try {
    const res = await fetch(`${base}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, dataset: { columns: cols.length ? cols : ['_one'], rows }, timeout_ms: config.pythonTimeoutMs }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) return { verification: { status: 'unavailable', detail: `The cross-check service responded with HTTP ${res.status}.` }, code };
    body = await res.json();
  } catch {
    if (signal?.aborted) throw new Error('cancelled');
    return { verification: { status: 'unavailable', detail: 'The cross-check service could not be reached.' }, code };
  }
  if (!body.success || !body.result) return { verification: { status: 'unavailable', detail: `The pandas cross-check failed: ${(body.stderr ?? 'no result').slice(0, 200)}` }, code };

  const keys = spec.dimensions.map(dimensionAlias);
  const measures = spec.measures.map(measureAlias);
  const pandas = new Map(body.result.rows.map((r) => [keyOf(r, keys), r]));
  const mismatches: string[] = [];
  for (const row of sqlResult.rows) {
    const other = pandas.get(keyOf(row, keys));
    if (!other) { mismatches.push(`group ${keyOf(row, keys)} missing in pandas`); continue; }
    for (const m of measures) {
      const a = row[m], b = other[m];
      if ((a === null || a === undefined) && (b === null || b === undefined)) continue;
      const x = Number(a), y = Number(b);
      if (typeof a === 'string' || typeof b === 'string') { if (String(a) !== String(b)) mismatches.push(`${m} for ${keyOf(row, keys)}`); continue; }
      if (!(Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x)))) mismatches.push(`${m} for ${keyOf(row, keys)}: SQL ${x} vs pandas ${y}`);
    }
  }
  return {
    code,
    verification: mismatches.length
      ? { status: 'mismatch', detail: `SQL and pandas disagree on ${mismatches.length} value${mismatches.length > 1 ? 's' : ''}: ${mismatches.slice(0, 3).join('; ')}.` }
      : { status: 'match', detail: `pandas independently reproduced all ${sqlResult.row_count} row${sqlResult.row_count === 1 ? '' : 's'} of the SQL result.` },
  };
}
