import { MAX_QUERY_ROWS, PYTHON_TIMEOUT_MS, QUERY_TIMEOUT_MS } from '@/lib/limits';
import type { DataSource } from '../datasource';
import { buildPython, buildSql } from '../sql-builder';
import { validateSql } from '../sql-validator';
import { executePython } from '../python-client';
import { newId } from '../datasource/registry';
import type { AnalysisPlan, AnalysisResult, QueryResult, TraceEvent } from '../types';
import { getProvider } from './anthropic-planner';

const MAX_ROWS = MAX_QUERY_ROWS;
const SQL_TIMEOUT = QUERY_TIMEOUT_MS;
const PY_TIMEOUT = PYTHON_TIMEOUT_MS;

/**
 * Orchestrator: question → plan → three parallel paths → interpret → answer.
 * 
 * Execution flow:
 * 1. User question is interpreted and plan is created
 * 2. Three independent analysis paths run in parallel:
 *    a. Query database (SQL against source data)
 *    b. Run code (Stats, transforms, models via Python)
 *    c. Generate chart metadata (based on plan)
 * 3. Interpret and validate all results
 * 4. Generate final answer and visualization
 */
export async function runAnalysis(
  ds: DataSource, question: string, history: string[],
): Promise<AnalysisResult> {
  const trace: TraceEvent[] = [];
  const timed = async <T,>(tool: string, fn: () => T | Promise<T>, detail = ''): Promise<T> => {
    const t0 = Date.now();
    try {
      const out = await fn();
      trace.push({ tool, status: 'ok', duration_ms: Date.now() - t0, detail });
      return out;
    } catch (e) {
      trace.push({ tool, status: 'error', duration_ms: Date.now() - t0, detail: e instanceof Error ? e.message : 'failed' });
      throw e;
    }
  };

  const schema = await timed('get_dataset_schema', () => ds.schema(), `${ds.schema().row_count} rows`);
  const profiles = await timed('get_column_profile', () => ds.profile(), `${schema.columns.length} columns`);
  const sample = await timed('get_sample_rows', () => ds.sample(10).rows, '10 rows');

  const provider = getProvider();
  let plan = await timed('create_analysis_plan', () => provider.plan({ question, schema, profiles, sampleRows: sample, history }), `provider=${provider.name}`);
  plan = guardPlan(plan, schema.columns.map((c) => c.name), trace);

  const analysisId = newId('an');
  const empty = (answer: string): AnalysisResult => ({
    analysis_id: analysisId, plan, answer, key_findings: [], sql: null, python: null,
    python_executed: false, result: null, chart: null,
    assumptions: plan.assumptions, warnings: plan.warnings, trace,
  });

  if (plan.needs_clarification) return empty(plan.clarification_question ?? 'Could you clarify the question?');
  if (plan.analysis_type === 'unsupported') {
    return empty(`This question cannot be answered from the available columns. ${plan.warnings.join(' ')} `
      + 'Try rephrasing it around one of those columns.');
  }

  // Build the three analysis paths from the plan
  const sql = buildSql(plan);
  const python = buildPython(plan);
  const warnings = [...plan.warnings];

  // ═════════════════════════════════════════════════════════════════════════════════
  // PARALLEL EXECUTION: Query database, Run code, Generate chart
  // ═════════════════════════════════════════════════════════════════════════════════

  // Path 1: Query database (SQL against source data)
  const queryDatabaseResult = (async () => {
    if (!sql) {
      if (plan.operation.kind === 'quality') {
        return await timed('profile_to_table', () => profileTable(ds), 'from cached profiles');
      } else if (plan.operation.kind === 'correlation') {
        return await timed('correlation_matrix', () => correlationTable(ds, plan.operation.kind === 'correlation' ? plan.operation.columns : []), 'pearson');
      }
      return null;
    }
    const validation = await timed('validate_sql', () => validateSql(sql, MAX_ROWS));
    trace[trace.length - 1].detail = `risk=${validation.estimated_risk}, parser=${validation.parser_used}`;
    if (!validation.valid) {
      throw new Error(`SQL failed validation: ${validation.errors.join(' ')}`);
    }
    warnings.push(...validation.warnings);
    return await timed('execute_read_only_sql', () => ds.executeReadOnlyQuery(sql, MAX_ROWS, SQL_TIMEOUT), 'read-only connection');
  })();

  // Path 2: Run code (Stats, transforms, models via Python)
  const runCodeResult = (async () => {
    if (!python) return { success: false, result: null, skipped_reason: 'No Python generated for this analysis type.', warnings: [] as string[], execution_time_ms: 0 };
    const frame = ds.toFrame(MAX_ROWS * 5);
    return await timed('execute_python_analysis', () => executePython(python, frame, PY_TIMEOUT), 'sandboxed service');
  })();

  // Chart metadata is derived after the result exists; SQL and Python remain parallel.
  let result: QueryResult | null = null;
  let pythonExecuted = false;
  try {
    const [sqlResult, pythonExec] = await Promise.all([queryDatabaseResult, runCodeResult]);
    result = sqlResult;
    warnings.push(...(result?.warnings ?? []));
    if (pythonExec.success && pythonExec.result) {
      pythonExecuted = true;
      if (!result) result = pythonExec.result;
      warnings.push(...pythonExec.warnings);
    } else if (pythonExec.skipped_reason) {
      trace.push({ tool: 'execute_python_analysis', status: 'skipped', duration_ms: 0, detail: pythonExec.skipped_reason });
      warnings.push(`${pythonExec.skipped_reason} The SQL result shown above was produced by the read-only SQL engine.`);
    }
    if (pythonExecuted && schema.row_count > MAX_ROWS * 5) {
      warnings.push(`Python execution used the first ${MAX_ROWS * 5} rows because the dataset exceeds the sandbox frame limit.`);
    }
  } catch (e) {
    return empty(`Analysis path failed: ${e instanceof Error ? e.message : 'unknown error'}`);
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // INTERPRET RESULTS: Finds patterns, checks numbers
  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

  await timed('validate_output', () => {
    if (result && result.rows.some((r) => Object.values(r).some((v) => typeof v === 'number' && !Number.isFinite(v)))) {
      warnings.push('Some computed values were not finite and are displayed unchanged.');
    }
    if (result?.truncated) warnings.push('The result set was truncated at the configured row limit.');
  }, result ? `${result.row_count} rows` : 'no result');

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // ANSWER + VISUALIZATION: Create final explanation and chart
  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

  const { answer, findings } = explain(plan, result);
  const chart = buildChart(plan, result);
  return {
    analysis_id: analysisId, plan, answer, key_findings: findings, sql, python,
    python_executed: pythonExecuted, result, chart,
    assumptions: plan.assumptions, warnings, trace,
  };
}

/** A plan may come from a model. Every column it names must exist in the real schema. */
function guardPlan(plan: AnalysisPlan, columns: string[], trace: TraceEvent[]): AnalysisPlan {
  const op = plan.operation;
  const named: string[] = op.kind === 'trend' ? [op.date_column, op.metric]
    : op.kind === 'group' ? [op.dimension, op.metric]
    : op.kind === 'share' ? [op.dimension]
    : op.kind === 'correlation' ? op.columns : [];
  const unknown = named.filter((c) => !columns.includes(c));
  if (unknown.length) {
    trace.push({ tool: 'guard_plan', status: 'error', duration_ms: 0, detail: `unknown columns: ${unknown.join(', ')}` });
    return {
      ...plan, analysis_type: 'unsupported', operation: { kind: 'none' },
      warnings: [...plan.warnings, `The plan referenced columns that do not exist: ${unknown.join(', ')}.`,
        `Available columns: ${columns.join(', ')}.`],
    };
  }
  trace.push({ tool: 'guard_plan', status: 'ok', duration_ms: 0, detail: 'all referenced columns exist' });
  return plan;
}

function profileTable(ds: DataSource): QueryResult {
  const rows = ds.profile().map((p) => ({
    column: p.column_name, inferred_type: p.inferred_type, nulls: p.null_count,
    null_pct: Number(p.null_percentage.toFixed(2)), unique: p.unique_count,
  }));
  return { columns: ['column', 'inferred_type', 'nulls', 'null_pct', 'unique'], rows, row_count: rows.length, truncated: false, execution_time_ms: 0, warnings: [] };
}

function correlationTable(ds: DataSource, cols: string[]): QueryResult {
  const frame = ds.toFrame(20_000).rows;
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < cols.length; i++) {
    for (let j = i + 1; j < cols.length; j++) {
      const r = pearson(frame, cols[i], cols[j]);
      if (r !== null) rows.push({ column_a: cols[i], column_b: cols[j], pearson_r: Number(r.toFixed(3)) });
    }
  }
  rows.sort((a, b) => Math.abs(b.pearson_r as number) - Math.abs(a.pearson_r as number));
  const warnings = ds.schema().row_count > 20_000
    ? ['Correlation uses the first 20,000 rows because the dataset exceeds the bounded analysis frame.']
    : [];
  return { columns: ['column_a', 'column_b', 'pearson_r'], rows, row_count: rows.length, truncated: false, execution_time_ms: 0, warnings };
}

export function pearson(rows: Record<string, unknown>[], a: string, b: string): number | null {
  const xs: number[] = [], ys: number[] = [];
  for (const r of rows) {
    const x = Number(r[a]), y = Number(r[b]);
    if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
  }
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sx += dx * dx; sy += dy * dy; }
  return sx && sy ? sxy / Math.sqrt(sx * sy) : null;
}

const fmt = (n: unknown) => typeof n === 'number' ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(n);

/** Hedged language by design: observations are separated from hypotheses. */
function explain(plan: AnalysisPlan, result: QueryResult | null): { answer: string; findings: string[] } {
  if (!result || !result.rows.length) {
    return { answer: 'The query returned no rows. Try widening the range, or check whether the values you filtered on exist in this dataset.', findings: [] };
  }
  const rows = result.rows;
  const op = plan.operation;
  if (op.kind === 'trend') {
    const key = `${op.agg}_${op.metric}`;
    const first = rows[0], last = rows[rows.length - 1];
    const a = Number(first[key]), b = Number(last[key]);
    const change = a ? ((b - a) / a) * 100 : 0;
    const peak = rows.reduce((x, y) => Number(y[key]) > Number(x[key]) ? y : x);
    return {
      answer: `In this dataset, ${op.metric} moved from ${fmt(a)} in ${first.month} to ${fmt(b)} in ${last.month}, a change of ${change >= 0 ? '+' : ''}${change.toFixed(1)}% across ${rows.length} months.`,
      findings: [
        `Peak month: ${peak.month} at ${fmt(peak[key])}.`,
        `Total across the period: ${fmt(rows.reduce((s, r) => s + Number(r[key]), 0))}.`,
        'A possible explanation for edge dips is partial coverage in the first or last month; this cannot be established from the date column alone.',
      ],
    };
  }
  if (op.kind === 'group') {
    const key = `${op.agg}_${op.metric}`;
    const top = rows[0], bottom = rows[rows.length - 1];
    const total = rows.reduce((s, r) => s + Number(r[key]), 0);
    return {
      answer: `${top[op.dimension]} leads on ${op.agg === 'avg' ? 'average' : 'total'} ${op.metric} at ${fmt(top[key])}${rows[1] ? `, ahead of ${rows[1][op.dimension]}` : ''}.`,
      findings: [
        `The top group accounts for ${((Number(top[key]) / total) * 100).toFixed(1)}% of the ${rows.length} groups shown.`,
        `Lowest: ${bottom[op.dimension]} at ${fmt(bottom[key])}.`,
        'This is a ranking difference only; the available columns do not establish why the groups differ.',
      ],
    };
  }
  if (op.kind === 'share') {
    const top = rows[0];
    return {
      answer: `${top[op.dimension]} is the most common value at ${top.pct}% of rows.`,
      findings: rows.slice(0, 4).map((r) => `${r[op.dimension]}: ${r.rows_count} rows (${r.pct}%).`),
    };
  }
  if (op.kind === 'correlation') {
    const top = rows[0];
    return {
      answer: top ? `The strongest linear relationship is ${top.column_a} vs ${top.column_b} (r = ${top.pearson_r}).` : 'No numeric pairs had enough complete rows to correlate.',
      findings: [...rows.slice(1, 3).map((r) => `${r.column_a} vs ${r.column_b}: r = ${r.pearson_r}.`),
        'Pearson r measures linear association only and does not establish causation.'],
    };
  }
  const withNulls = rows.filter((r) => Number(r.nulls) > 0);
  const worst = [...rows].sort((a, b) => Number(b.null_pct) - Number(a.null_pct))[0];
  return {
    answer: `${withNulls.length} of ${rows.length} columns contain missing values.`,
    findings: [
      worst && Number(worst.null_pct) > 0 ? `${worst.column} has the most missing data (${worst.null_pct}%).` : 'No column has missing values.',
      'Missing values are retained in the raw dataset; nothing was dropped or filled.',
    ],
  };
}

function buildChart(plan: AnalysisPlan, result: QueryResult | null): AnalysisResult['chart'] {
  const rec = plan.chart_recommendation;
  if (!rec.should_create || !result || !result.rows.length || !rec.x_column) return null;
  const y = rec.y_columns[0];
  if (!result.columns.includes(rec.x_column) || !result.columns.includes(y)) return null; // config must match the data
  const values = result.rows.map((r) => Number(r[y])).filter(Number.isFinite);
  return {
    chart_type: rec.chart_type, x_column: rec.x_column, y_columns: [y],
    title: `${y} by ${rec.x_column}`, x_label: rec.x_column, y_label: y,
    accessibility_description: `${rec.chart_type} chart of ${y} by ${rec.x_column}, ${result.rows.length} points ranging from `
      + `${Math.min(...values).toLocaleString()} to ${Math.max(...values).toLocaleString()}.`,
  };
}
