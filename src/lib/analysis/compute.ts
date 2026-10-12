import 'server-only';
import type Database from 'better-sqlite3';
import { formatInteger, formatNumber, formatPercent, formatStat } from '../format';
import { runSelect, toTable } from '../query/execute';
import {
  buildAggregateSql, buildCountSql, buildGroupCountSql, buildSelectSql, buildTotalSql, buildValueCountsSql,
  compileFilters, dimensionAlias, displaySql, measureAlias, quoteIdent, type CompiledSql,
} from '../query/sql';
import {
  correlationStrength, histogram, linearFit, mean, pearson, quantileSorted, sortNumbers, spearman, std,
} from '../stats';
import type { ChartSpec, ColumnType, DatasetInfo, Fact, TableResult, ValueFormat } from '../types';
import { categoryChart, heatmapChart, histogramChart, labelOf, MISSING_LABEL, pivotChart, scatterChart, timeChart } from './charts';
import type { AggregateSpec, AnalysisSpec, ChartPreference, Filter, Measure } from './spec';

/**
 * Executes a guarded spec. Everything here is deterministic: SQL against the
 * read-only dataset plus plain TypeScript statistics. The "facts" and the
 * computed summary are the ground truth that any AI narrative is checked against.
 */
export interface Computation {
  sql: string | null;
  result: TableResult | null;
  facts: Fact[];
  summary: string;
  chart: ChartSpec | null;
  warnings: string[];
  steps: { step: string; ms: number; detail: string }[];
}

interface Ctx {
  db: Database.Database;
  info: DatasetInfo;
  types: Map<string, ColumnType>;
  maxResultRows: number;
  preference: ChartPreference;
  steps: Computation['steps'];
  sqls: string[];
}

export function compute(db: Database.Database, info: DatasetInfo, spec: AnalysisSpec, preference: ChartPreference, maxResultRows: number): Computation {
  const ctx: Ctx = { db, info, types: new Map(info.columns.map((c) => [c.name, c.type])), maxResultRows, preference, steps: [], sqls: [] };
  let out: Omit<Computation, 'sql' | 'steps'>;
  switch (spec.kind) {
    case 'aggregate': out = aggregate(ctx, spec); break;
    case 'distribution': out = distribution(ctx, spec.column, spec.filters); break;
    case 'correlation': out = correlation(ctx, spec.columns, spec.method, spec.filters); break;
    case 'relationship': out = relationship(ctx, spec.x, spec.y, spec.color_by, spec.filters); break;
    case 'describe': out = describe(ctx, spec.columns, spec.filters); break;
    case 'outliers': out = outliers(ctx, spec.column, spec.filters); break;
    case 'rows': out = listRows(ctx, spec); break;
    case 'quality': out = quality(ctx, spec.columns); break;
  }
  return { ...out, sql: ctx.sqls.length ? ctx.sqls.join(';\n\n') + ';' : null, steps: ctx.steps };
}

function run(ctx: Ctx, compiled: CompiledSql, detail: string): Record<string, unknown>[] {
  const { rows, ms } = runSelect(ctx.db, compiled);
  ctx.sqls.push(displaySql(compiled));
  ctx.steps.push({ step: 'execute_sql', ms, detail: `${detail} · ${rows.length} row${rows.length === 1 ? '' : 's'}` });
  return rows;
}

function timed<T>(ctx: Ctx, step: string, detail: string, fn: () => T): T {
  const t0 = performance.now();
  const v = fn();
  ctx.steps.push({ step, ms: Math.round(performance.now() - t0), detail });
  return v;
}

const fact = (id: string, label: string, value: number | string, display?: string, detail?: string): Fact =>
  ({ id, label, value, display: display ?? (typeof value === 'number' ? formatNumber(value) : value), ...(detail ? { detail } : {}) });

export function measureLabel(m: Measure): string {
  if (m.agg === 'count') return m.column ? `count of ${m.column}` : 'number of rows';
  if (m.agg === 'count_distinct') return `distinct ${m.column}`;
  const word = { sum: 'total', avg: 'average', min: 'minimum', max: 'maximum' }[m.agg];
  return `${word} ${m.column}`;
}

const measureFormat = (m: Measure): ValueFormat => (m.agg === 'count' || m.agg === 'count_distinct' ? 'integer' : 'number');

export function describeFilters(filters: Filter[]): string {
  if (!filters.length) return '';
  const op: Record<string, string> = { eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' };
  return filters.map((f) => {
    if (f.op in op) return `${f.column} ${op[f.op]} ${f.value}`;
    if (f.op === 'between') return `${f.column} between ${f.values?.[0]} and ${f.values?.[1]}`;
    if (f.op === 'in') return `${f.column} in (${f.values?.join(', ')})`;
    if (f.op === 'not_in') return `${f.column} not in (${f.values?.join(', ')})`;
    if (f.op === 'contains') return `${f.column} contains "${f.value}"`;
    if (f.op === 'starts_with') return `${f.column} starts with "${f.value}"`;
    return `${f.column} ${f.op === 'is_null' ? 'is missing' : 'is present'}`;
  }).join(' and ');
}

const scope = (filters: Filter[]) => (filters.length ? ` (where ${describeFilters(filters)})` : '');
const fmt = (v: unknown, m?: Measure) => (typeof v === 'number' ? (m && measureFormat(m) === 'integer' ? formatInteger(v) : formatNumber(v)) : labelOf(v));

// ------------------------------------------------------------------ aggregate

function aggregate(ctx: Ctx, spec: AggregateSpec): Omit<Computation, 'sql' | 'steps'> {
  const warnings: string[] = [];
  const cap = Math.min(spec.limit ?? ctx.maxResultRows, ctx.maxResultRows);
  const rows = run(ctx, buildAggregateSql(spec, ctx.types, ctx.maxResultRows), 'aggregate');
  const table = toTable(rows, cap);
  const m0 = spec.measures[0];
  const k0 = measureAlias(m0);
  const facts: Fact[] = [];

  let groupCount = table.row_count;
  if (spec.dimensions.length && (table.truncated || spec.limit)) {
    groupCount = Number(run(ctx, buildGroupCountSql(spec, ctx.types), 'count groups')[0]?.n ?? table.row_count);
  }
  // A requested "top N" is not truncation; an unrequested cut is.
  if (spec.limit && table.row_count <= spec.limit) table.truncated = false;
  if (table.truncated) warnings.push(`Only the first ${formatInteger(cap)} of ${formatInteger(groupCount)} groups are included.`);

  if (spec.include_share && spec.dimensions.length) {
    const total = Number(run(ctx, buildTotalSql(spec, ctx.types), 'overall total')[0]?.total);
    if (Number.isFinite(total) && total !== 0) {
      for (const r of table.rows) r.share_pct = Number(((Number(r[k0]) / total) * 100).toFixed(2));
      table.columns.push({ name: 'share_pct', kind: 'number' });
      facts.push(fact('overall_total', `Overall ${measureLabel(m0)}`, total, fmt(total, m0)));
    }
  }

  const title = spec.dimensions.length
    ? `${capitalize(measureLabel(m0))} by ${spec.dimensions.map((d) => d.time_grain ? `${d.time_grain}` : d.column).join(' and ')}`
    : capitalize(spec.measures.map(measureLabel).join(', '));
  const base = { title, yLabel: measureLabel(m0), format: measureFormat(m0), preference: ctx.preference };

  // No grouping: one row of overall numbers.
  if (!spec.dimensions.length) {
    const row = table.rows[0] ?? {};
    spec.measures.forEach((m) => facts.push(fact(measureAlias(m), capitalize(measureLabel(m)), row[measureAlias(m)] as number, fmt(row[measureAlias(m)], m))));
    const parts = spec.measures.map((m) => `${measureLabel(m)} is ${fmt(row[measureAlias(m)], m)}`);
    const summary = row[k0] === null || row[k0] === undefined
      ? `No rows matched${scope(spec.filters)}, so there is nothing to aggregate.`
      : `${capitalize(parts.join('; '))}${scope(spec.filters)}.`;
    return { result: table, facts, summary, chart: null, warnings };
  }

  const values = table.rows.map((r) => Number(r[k0])).filter(Number.isFinite);
  if (!table.rows.length || !values.length) {
    return { result: table, facts, summary: `No rows matched${scope(spec.filters)}.`, chart: null, warnings };
  }

  // Two groupings: a pivot.
  if (spec.dimensions.length === 2) {
    const [d1, d2] = spec.dimensions;
    const a1 = dimensionAlias(d1), a2 = dimensionAlias(d2);
    const best = table.rows.reduce((a, b) => (Number(b[k0]) > Number(a[k0]) ? b : a));
    facts.push(fact('top_combination', 'Highest combination', Number(best[k0]), fmt(best[k0], m0), `${labelOf(best[a1])} · ${labelOf(best[a2])}`));
    facts.push(fact('combinations', 'Combinations', groupCount, formatInteger(groupCount)));
    const timeFirst = Boolean(d1.time_grain) || !d2.time_grain;
    const [xKey, sKey] = timeFirst ? [a1, a2] : [a2, a1];
    const chart = pivotChart(table.rows, xKey, sKey, k0, {
      ...base, xLabel: xKey, xIsTime: Boolean(d1.time_grain || d2.time_grain),
      additive: ['sum', 'count'].includes(m0.agg),
    });
    return {
      result: table, facts, chart, warnings,
      summary: `The highest ${measureLabel(m0)} is for ${labelOf(best[a1])} / ${labelOf(best[a2])} at ${fmt(best[k0], m0)}, across ${formatInteger(groupCount)} combinations${scope(spec.filters)}.`,
    };
  }

  const d = spec.dimensions[0];
  const key = dimensionAlias(d);

  // One time grouping: a trend.
  if (d.time_grain) {
    const series = table.rows.filter((r) => r[key] !== null && Number.isFinite(Number(r[k0])));
    if (series.length < 1) return { result: table, facts, summary: `No dated rows matched${scope(spec.filters)}.`, chart: null, warnings };
    const first = series[0], last = series[series.length - 1];
    const a = Number(first[k0]), b = Number(last[k0]);
    const peak = series.reduce((x, y) => (Number(y[k0]) > Number(x[k0]) ? y : x));
    const trough = series.reduce((x, y) => (Number(y[k0]) < Number(x[k0]) ? y : x));
    facts.push(fact('first_period', `First ${d.time_grain} (${labelOf(first[key])})`, a, fmt(a, m0)));
    facts.push(fact('last_period', `Last ${d.time_grain} (${labelOf(last[key])})`, b, fmt(b, m0)));
    let changeText = '';
    if (series.length > 1) {
      facts.push(fact('change', 'Change first → last', b - a, `${b - a >= 0 ? '+' : ''}${fmt(b - a, m0)}`));
      if (a !== 0) {
        const pct = ((b - a) / Math.abs(a)) * 100;
        facts.push(fact('change_pct', 'Change first → last (%)', Number(pct.toFixed(1)), `${pct >= 0 ? '+' : ''}${formatPercent(pct)}`));
        changeText = ` (${pct >= 0 ? '+' : ''}${formatPercent(pct)})`;
      }
      facts.push(fact('peak', `Peak ${d.time_grain}`, Number(peak[k0]), fmt(peak[k0], m0), labelOf(peak[key])));
      facts.push(fact('trough', `Lowest ${d.time_grain}`, Number(trough[k0]), fmt(trough[k0], m0), labelOf(trough[key])));
      facts.push(fact('period_mean', `Average per ${d.time_grain}`, mean(series.map((r) => Number(r[k0]))), formatStat(mean(series.map((r) => Number(r[k0]))))));
    }
    const partial = partialPeriods(ctx.info, d.column, d.time_grain, labelOf(first[key]), labelOf(last[key]));
    if (partial) warnings.push(partial);
    const missingDates = table.rows.length - series.length;
    if (missingDates) warnings.push(`${missingDates} group with a missing ${d.column} is excluded from the trend.`);
    return {
      result: table, facts, warnings,
      chart: timeChart(table.rows, key, k0, { ...base, xLabel: `${d.column} (${d.time_grain})` }),
      summary: series.length > 1
        ? `${capitalize(measureLabel(m0))} went from ${fmt(a, m0)} in ${labelOf(first[key])} to ${fmt(b, m0)} in ${labelOf(last[key])}${changeText}, peaking in ${labelOf(peak[key])} at ${fmt(peak[k0], m0)}${scope(spec.filters)}.`
        : `${capitalize(measureLabel(m0))} was ${fmt(a, m0)} in ${labelOf(first[key])}, the only period${scope(spec.filters)}.`,
    };
  }

  // One categorical grouping: a ranking. Rows with a missing group value are
  // reported separately and never "win" the ranking.
  const missingGroup = table.rows.find((r) => r[key] === null);
  const ranked = table.rows.filter((r) => r[key] !== null && Number.isFinite(Number(r[k0]))).sort((x, y) => Number(y[k0]) - Number(x[k0]));
  if (!ranked.length) {
    return { result: table, facts, warnings, chart: null, summary: `Every matching row has a missing ${d.column}${scope(spec.filters)}.` };
  }
  const top = ranked[0], second = ranked[1], bottom = ranked[ranked.length - 1];
  facts.push(fact('top_group', `Highest ${d.column}`, Number(top[k0]), fmt(top[k0], m0), labelOf(top[key])));
  if (ranked.length > 1) facts.push(fact('bottom_group', `Lowest ${d.column}`, Number(bottom[k0]), fmt(bottom[k0], m0), labelOf(bottom[key])));
  facts.push(fact('groups', `${capitalize(d.column)} groups`, groupCount, formatInteger(groupCount)));
  let shareText = '';
  if (['sum', 'count'].includes(m0.agg) && values.every((v) => v >= 0)) {
    const totalFact = facts.find((f) => f.id === 'overall_total');
    const total = totalFact ? Number(totalFact.value) : (spec.limit || table.truncated ? NaN : values.reduce((s, v) => s + v, 0));
    if (Number.isFinite(total) && total > 0) {
      const share = (Number(top[k0]) / total) * 100;
      shareText = `, ${formatPercent(share)} of the total`;
      if (!totalFact) facts.push(fact('overall_total', `Overall ${measureLabel(m0)}`, total, fmt(total, m0)));
      // With few groups, every group's share is a useful number in its own right.
      const shareRows = spec.include_share && ranked.length <= 6 ? ranked : [top];
      for (const r of shareRows) {
        const pct = (Number(r[k0]) / total) * 100;
        facts.push(fact(`share_${labelOf(r[key])}`, `${labelOf(r[key])} share of total`, Number(pct.toFixed(1)), formatPercent(pct)));
      }
    }
  }
  if (ranked.length > 1 && Number(bottom[k0]) > 0) {
    const ratio = Number(top[k0]) / Number(bottom[k0]);
    if (ratio >= 1.05) facts.push(fact('top_bottom_ratio', 'Highest ÷ lowest', Number(ratio.toFixed(2)), `${ratio.toFixed(2)}×`));
  }
  if (missingGroup) {
    warnings.push(`Rows with a missing ${d.column} are shown as "${MISSING_LABEL}" (${measureLabel(m0)}: ${fmt(missingGroup[k0], m0)}) and are left out of the ranking.`);
  }
  const limited = spec.limit && groupCount > table.row_count ? ` Showing ${table.row_count} of ${formatInteger(groupCount)} groups.` : '';
  return {
    result: table, facts, warnings,
    chart: categoryChart(table.rows, key, k0, { ...base, xLabel: d.column, sortedByValue: !spec.sort || spec.sort.by === 'measure' }),
    summary: `${labelOf(top[key])} has the highest ${measureLabel(m0)} at ${fmt(top[k0], m0)}${shareText}`
      + (second ? `, followed by ${labelOf(second[key])} (${fmt(second[k0], m0)})` : '')
      + (ranked.length > 2 ? `. ${labelOf(bottom[key])} is lowest at ${fmt(bottom[k0], m0)}` : '')
      + `${scope(spec.filters)}.${limited}`,
  };
}

/** Flags first/last periods that the data covers only partly, so a dip is not misread as a decline. */
function partialPeriods(info: DatasetInfo, column: string, grain: string, firstLabel: string, lastLabel: string): string | null {
  const range = info.columns.find((c) => c.name === column)?.date;
  if (!range || grain === 'day') return null;
  const startOf: Record<string, (d: string) => boolean> = {
    week: () => false,
    month: (d) => d.slice(8, 10) === '01',
    quarter: (d) => ['01-01', '04-01', '07-01', '10-01'].includes(d.slice(5, 10)),
    year: (d) => d.slice(5, 10) === '01-01',
  };
  const endOf: Record<string, (d: string) => boolean> = {
    week: () => false,
    month: (d) => { const [y, m] = d.split('-').map(Number); return Number(d.slice(8, 10)) === new Date(Date.UTC(y, m, 0)).getUTCDate(); },
    quarter: (d) => ['03-31', '06-30', '09-30', '12-31'].includes(d.slice(5, 10)),
    year: (d) => d.slice(5, 10) === '12-31',
  };
  const parts: string[] = [];
  if (grain !== 'week' && !startOf[grain](range.min) && range.min.startsWith(firstLabel.slice(0, 4))) parts.push(`the first ${grain} (${firstLabel}) starts on ${range.min}`);
  if (grain !== 'week' && !endOf[grain](range.max) && range.max.startsWith(lastLabel.slice(0, 4))) parts.push(`the last ${grain} (${lastLabel}) ends on ${range.max}`);
  return parts.length ? `The data covers partial periods: ${parts.join(' and ')}. Totals for ${parts.length > 1 ? 'those periods' : 'that period'} are not comparable with full ones.` : null;
}

// ------------------------------------------------------------------ distribution

function numericValues(ctx: Ctx, column: string, filters: Filter[]): number[] {
  const rows = run(ctx, buildSelectSql([column], filters, ctx.types, { notNull: [column] }), `values of ${column}`);
  return rows.map((r) => Number(r[column])).filter(Number.isFinite);
}

function distribution(ctx: Ctx, column: string, filters: Filter[]): Omit<Computation, 'sql' | 'steps'> {
  const type = ctx.types.get(column);
  const counts = run(ctx, buildCountSql(filters, ctx.types, column), 'row count')[0] as { total: number; present: number };
  const missing = counts.total - counts.present;
  const warnings = missing ? [`${formatInteger(missing)} of ${formatInteger(counts.total)} rows have no ${column} and are excluded.`] : [];

  if (type === 'numeric') {
    const sorted = timed(ctx, 'compute_statistics', `distribution of ${column}`, () => sortNumbers(numericValues(ctx, column, filters)));
    if (!sorted.length) return { result: null, facts: [], summary: `No ${column} values matched${scope(filters)}.`, chart: null, warnings };
    const bins = histogram(sorted);
    const m = mean(sorted), med = quantileSorted(sorted, 0.5), sd = std(sorted);
    const p25 = quantileSorted(sorted, 0.25), p75 = quantileSorted(sorted, 0.75);
    const facts = [
      fact('count', 'Values', sorted.length, formatInteger(sorted.length)),
      fact('mean', 'Mean', m, formatStat(m)),
      fact('median', 'Median', med, formatStat(med)),
      fact('std', 'Standard deviation', sd, formatStat(sd)),
      fact('min', 'Minimum', sorted[0], formatStat(sorted[0])),
      fact('p25', '25th percentile', p25, formatStat(p25)),
      fact('p75', '75th percentile', p75, formatStat(p75)),
      fact('max', 'Maximum', sorted[sorted.length - 1], formatStat(sorted[sorted.length - 1])),
    ];
    const skew = sd > 0 ? (m - med) / sd : 0;
    const shape = Math.abs(skew) < 0.1 ? 'roughly symmetric' : skew > 0 ? 'skewed to the right (a tail of high values pulls the mean above the median)' : 'skewed to the left (a tail of low values pulls the mean below the median)';
    const total = sorted.length;
    const result = toTable(bins.map((b) => ({ bin_start: b.start, bin_end: b.end, count: b.count, share_pct: Number(((b.count / total) * 100).toFixed(2)) })), 1000);
    return {
      result, facts, warnings,
      chart: histogramChart(bins, { title: `Distribution of ${column}`, xLabel: column, yLabel: 'Rows', preference: ctx.preference }),
      summary: `${capitalize(column)} ranges from ${formatStat(sorted[0])} to ${formatStat(sorted[sorted.length - 1])}; half of the values lie between ${formatStat(p25)} and ${formatStat(p75)}, with a median of ${formatStat(med)} and a mean of ${formatStat(m)}. The distribution is ${shape}${scope(filters)}.`,
    };
  }

  // Categorical, text, boolean, identifier and date columns: value counts.
  const limit = 30;
  const rows = run(ctx, buildValueCountsSql(column, filters, ctx.types, type === 'date' ? 1000 : limit + 1), `value counts of ${column}`);
  const total = counts.total;
  const present = rows.filter((r) => r.value !== null);
  const shown = type === 'date' ? present : present.slice(0, limit);
  const table = toTable(shown.map((r) => ({ [column]: r.value, count: r.count, share_pct: Number(((Number(r.count) / total) * 100).toFixed(2)) })), 1000);
  table.truncated = type !== 'date' && present.length > limit;
  const distinct = Number(run(ctx, {
    sql: `SELECT COUNT(DISTINCT ${quoteIdent(column)}) AS n FROM dataset ${compileFilters(filters, ctx.types).sql}`.trim(),
    params: compileFilters(filters, ctx.types).params,
  }, 'distinct values')[0]?.n ?? 0);
  if (!shown.length) return { result: table, facts: [], summary: `No ${column} values matched${scope(filters)}.`, chart: null, warnings };
  const facts: Fact[] = [fact('distinct', 'Distinct values', distinct, formatInteger(distinct))];

  if (type === 'date') {
    const peak = shown.reduce((a, b) => (Number(b.count) > Number(a.count) ? b : a));
    facts.push(fact('busiest_month', 'Busiest month', Number(peak.count), formatInteger(Number(peak.count)), String(peak.value)));
    return {
      result: table, facts, warnings,
      chart: timeChart(shown.map((r) => ({ month: r.value, count: r.count })), 'month', 'count', { title: `Rows per month of ${column}`, xLabel: `${column} (month)`, yLabel: 'Rows', format: 'integer', preference: ctx.preference }),
      summary: `${capitalize(column)} spans ${shown.length} months from ${shown[0].value} to ${shown[shown.length - 1].value}; the busiest month is ${peak.value} with ${formatInteger(Number(peak.count))} rows${scope(filters)}.`,
    };
  }
  const top = shown[0];
  const topShare = (Number(top.count) / total) * 100;
  facts.push(fact('most_common', 'Most common value', Number(top.count), `${formatInteger(Number(top.count))} rows`, String(top.value)));
  facts.push(fact('most_common_share', `${top.value} share`, Number(topShare.toFixed(1)), formatPercent(topShare)));
  return {
    result: table, facts, warnings,
    chart: categoryChart(shown.map((r) => ({ value: r.value, count: r.count })), 'value', 'count', { title: `Rows by ${column}`, xLabel: column, yLabel: 'Rows', format: 'integer', preference: ctx.preference, sortedByValue: true }),
    summary: `${capitalize(column)} has ${formatInteger(distinct)} distinct values. The most common is "${top.value}" with ${formatInteger(Number(top.count))} rows (${formatPercent(topShare)})${shown[1] ? `, followed by "${shown[1].value}" (${formatInteger(Number(shown[1].count))})` : ''}${scope(filters)}.`,
  };
}

// ------------------------------------------------------------------ correlation & relationship

function correlation(ctx: Ctx, columns: string[], method: 'pearson' | 'spearman', filters: Filter[]): Omit<Computation, 'sql' | 'steps'> {
  const rows = run(ctx, buildSelectSql(columns, filters, ctx.types), 'numeric columns');
  const fn = method === 'spearman' ? spearman : pearson;
  const pairs: { a: string; b: string; r: number; n: number }[] = [];
  const matrix: (number | null)[][] = columns.map(() => columns.map(() => null));
  timed(ctx, 'compute_statistics', `${method} correlation, ${columns.length} columns`, () => {
    for (let i = 0; i < columns.length; i++) {
      matrix[i][i] = 1;
      for (let j = i + 1; j < columns.length; j++) {
        const xs: number[] = [], ys: number[] = [];
        for (const r of rows) {
          const x = r[columns[i]], y = r[columns[j]];
          if (typeof x === 'number' && typeof y === 'number') { xs.push(x); ys.push(y); }
        }
        const r = fn(xs, ys);
        if (r !== null) {
          const rounded = Number(r.toFixed(3));
          pairs.push({ a: columns[i], b: columns[j], r: rounded, n: xs.length });
          matrix[i][j] = matrix[j][i] = rounded;
        }
      }
    }
  });
  pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  const result = toTable(pairs.map((p) => ({ column_a: p.a, column_b: p.b, [method === 'spearman' ? 'spearman_rho' : 'pearson_r']: p.r, rows_used: p.n, strength: correlationStrength(p.r) })), 1000);
  if (!pairs.length) return { result, facts: [], summary: 'No pair of columns had enough complete rows (at least 3) to correlate.', chart: null, warnings: [] };
  const symbol = method === 'spearman' ? 'ρ' : 'r';
  const facts = pairs.slice(0, 3).map((p, i) => fact(`pair_${i + 1}`, `${p.a} ↔ ${p.b}`, p.r, `${symbol} = ${p.r.toFixed(2)}`, `${correlationStrength(p.r)}, ${formatInteger(p.n)} rows`));
  const top = pairs[0];
  const weakest = pairs[pairs.length - 1];
  return {
    result, facts,
    chart: ctx.preference === 'none' || ctx.preference === 'table' ? null : heatmapChart(columns, matrix, `${method === 'spearman' ? 'Spearman' : 'Pearson'} correlation matrix`),
    warnings: ['Correlation measures association, not causation.'],
    summary: `The strongest relationship is between ${top.a} and ${top.b} (${symbol} = ${top.r.toFixed(2)}, ${correlationStrength(top.r)}, ${formatInteger(top.n)} rows)${pairs.length > 2 ? `; the weakest is ${weakest.a} and ${weakest.b} (${symbol} = ${weakest.r.toFixed(2)})` : ''}${scope(filters)}.`,
  };
}

function relationship(ctx: Ctx, x: string, y: string, colorBy: string | null, filters: Filter[]): Omit<Computation, 'sql' | 'steps'> {
  const cols = colorBy ? [x, y, colorBy] : [x, y];
  const rows = run(ctx, buildSelectSql(cols, filters, ctx.types, { notNull: [x, y] }), 'paired values');
  const xs = rows.map((r) => Number(r[x])), ys = rows.map((r) => Number(r[y]));
  if (xs.length < 3) return { result: null, facts: [], summary: `Fewer than three rows have both ${x} and ${y}${scope(filters)}, so no relationship can be measured.`, chart: null, warnings: [] };
  const { r, rho, fit } = timed(ctx, 'compute_statistics', 'correlation and least-squares fit', () => ({ r: pearson(xs, ys), rho: spearman(xs, ys), fit: linearFit(xs, ys) }));
  const facts: Fact[] = [fact('n', 'Rows with both values', xs.length, formatInteger(xs.length))];
  if (r !== null) facts.push(fact('pearson_r', 'Pearson r', Number(r.toFixed(3)), r.toFixed(2), correlationStrength(r)));
  if (rho !== null) facts.push(fact('spearman_rho', 'Spearman ρ', Number(rho.toFixed(3)), rho.toFixed(2)));
  if (fit) facts.push(fact('slope', `Change in ${y} per 1 ${x}`, Number(fit.slope.toPrecision(4)), formatStat(fit.slope)));

  // Colour by the three largest groups (CVD-safe cap); the rest become "Other".
  let groups: string[] = [];
  if (colorBy) {
    const counts = new Map<string, number>();
    rows.forEach((row) => counts.set(labelOf(row[colorBy]), (counts.get(labelOf(row[colorBy])) ?? 0) + 1));
    const topGroups = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
    groups = counts.size > 3 ? [...topGroups, 'Other'] : topGroups;
  }
  const stride = Math.max(1, Math.ceil(rows.length / 2000));
  const points = rows.filter((_, i) => i % stride === 0).map((row) => {
    const g = colorBy ? labelOf(row[colorBy]) : null;
    return { x: Number(row[x]), y: Number(row[y]), group: colorBy ? (groups.includes(g!) ? g : 'Other') : null };
  });
  const note = stride > 1 ? `Plotting every ${stride}th row (${formatInteger(points.length)} of ${formatInteger(rows.length)}); statistics use all rows.` : null;
  const result = toTable(rows.slice(0, 1000).map((row) => Object.fromEntries(cols.map((c) => [c, row[c]]))), 1000);
  result.truncated = rows.length > 1000;
  return {
    result, facts,
    chart: scatterChart(points, { title: `${capitalize(y)} vs ${x}`, xLabel: x, yLabel: y, preference: ctx.preference, trend: fit, note, groups }),
    warnings: ['Correlation measures association, not causation.'],
    summary: r === null
      ? `${capitalize(x)} or ${y} has no variation${scope(filters)}, so a correlation cannot be computed.`
      : `${capitalize(x)} and ${y} have a ${correlationStrength(r)} linear relationship (r = ${r.toFixed(2)}, ${formatInteger(xs.length)} rows)${fit ? `; on average ${y} changes by ${formatStat(fit.slope)} for each additional unit of ${x}` : ''}${scope(filters)}.`,
  };
}

// ------------------------------------------------------------------ describe, outliers, rows, quality

function describe(ctx: Ctx, columns: string[], filters: Filter[]): Omit<Computation, 'sql' | 'steps'> {
  const rows = run(ctx, buildSelectSql(columns, filters, ctx.types), 'selected columns');
  const out = timed(ctx, 'compute_statistics', `summary of ${columns.length} columns`, () => columns.map((c) => {
    const type = ctx.types.get(c)!;
    const present = rows.map((r) => r[c]).filter((v) => v !== null && v !== undefined);
    const base = { column: c, type, count: present.length, missing: rows.length - present.length, distinct: new Set(present.map(String)).size };
    if (type === 'numeric') {
      const sorted = sortNumbers(present.map(Number));
      return { ...base, mean: round(mean(sorted)), std: round(std(sorted)), min: sorted[0] ?? null, median: round(quantileSorted(sorted, 0.5)), max: sorted[sorted.length - 1] ?? null, most_common: null };
    }
    const counts = new Map<string, number>();
    present.forEach((v) => counts.set(String(v), (counts.get(String(v)) ?? 0) + 1));
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const sortedText = present.map(String).sort();
    return { ...base, mean: null, std: null, min: type === 'date' ? sortedText[0] ?? null : null, median: null, max: type === 'date' ? sortedText[sortedText.length - 1] ?? null : null, most_common: top ? `${top[0]} (${top[1]})` : null };
  }));
  const result = toTable(out, 1000, ['column', 'type', 'count', 'missing', 'distinct', 'mean', 'std', 'min', 'median', 'max', 'most_common']);
  const facts = [fact('rows', 'Rows considered', rows.length, formatInteger(rows.length)), fact('columns', 'Columns summarised', columns.length, String(columns.length))];
  const numeric = out.filter((o) => o.type === 'numeric');
  for (const n of numeric.slice(0, 4)) {
    if (typeof n.mean === 'number') facts.push(fact(`mean_${n.column}`, `Mean ${n.column}`, n.mean, formatStat(n.mean), `median ${formatStat(Number(n.median))}`));
  }
  return {
    result, facts, chart: null, warnings: [],
    summary: `Summary statistics for ${columns.length === 1 ? columns[0] : `${columns.length} columns`} over ${formatInteger(rows.length)} rows${scope(filters)}.`
      + (numeric.length ? ` ${numeric.slice(0, 3).map((n) => `${n.column}: mean ${formatStat(Number(n.mean))}, median ${formatStat(Number(n.median))}`).join('; ')}.` : ''),
  };
}

const round = (n: number) => (Number.isFinite(n) ? Number(n.toPrecision(6)) : null);

function outliers(ctx: Ctx, column: string, filters: Filter[]): Omit<Computation, 'sql' | 'steps'> {
  const sorted = sortNumbers(numericValues(ctx, column, filters));
  if (sorted.length < 4) return { result: null, facts: [], summary: `Too few ${column} values to look for outliers.`, chart: null, warnings: [] };
  const p25 = quantileSorted(sorted, 0.25), p75 = quantileSorted(sorted, 0.75);
  const iqr = p75 - p25;
  const lo = p25 - 1.5 * iqr, hi = p75 + 1.5 * iqr;
  const where = compileFilters(filters, ctx.types);
  const c = quoteIdent(column);
  const conditions = [where.sql.replace(/^WHERE /, ''), `(${c} < ? OR ${c} > ?)`].filter(Boolean);
  const median = quantileSorted(sorted, 0.5);
  const flagged = run(ctx, {
    sql: `SELECT *\nFROM dataset\nWHERE ${conditions.join('\n  AND ')}\nORDER BY ABS(${c} - ?) DESC\nLIMIT 101`,
    params: [...where.params, lo, hi, median],
  }, `rows outside ${formatStat(lo)}–${formatStat(hi)}`);
  const count = sorted.filter((x) => x < lo || x > hi).length;
  const high = sorted.filter((x) => x > hi).length;
  const table = toTable(flagged, 100);
  const facts = [
    fact('outliers', 'Outliers (1.5 × IQR)', count, formatInteger(count)),
    fact('outlier_share', 'Share of values', Number(((count / sorted.length) * 100).toFixed(2)), formatPercent((count / sorted.length) * 100, 2)),
    fact('lower_fence', 'Lower fence', lo, formatStat(lo)),
    fact('upper_fence', 'Upper fence', hi, formatStat(hi)),
    fact('median', 'Median', median, formatStat(median)),
  ];
  return {
    result: table, facts,
    chart: histogramChart(histogram(sorted), { title: `Distribution of ${column} with outlier fences`, xLabel: column, yLabel: 'Rows', preference: ctx.preference, references: [{ value: lo, label: 'Lower fence' }, { value: hi, label: 'Upper fence' }] }),
    warnings: count ? ['Outliers are flagged statistically; they may be valid extreme values rather than errors.'] : [],
    summary: (() => {
      // A fence beyond the data's own range cannot flag anything, so only the meaningful side is described.
      const range = lo < sorted[0] ? `above ${formatStat(hi)}` : hi > sorted[sorted.length - 1] ? `below ${formatStat(lo)}` : `outside ${formatStat(lo)} to ${formatStat(hi)}`;
      return count
        ? `${formatInteger(count)} of ${formatInteger(sorted.length)} ${column} values (${formatPercent((count / sorted.length) * 100, 2)}) are unusually ${high === count ? 'high' : high === 0 ? 'low' : 'extreme'}: ${range} (1.5 × IQR beyond the quartiles)${high && high !== count ? `, ${formatInteger(high)} high and ${formatInteger(count - high)} low` : ''}${scope(filters)}.`
        : `No ${column} values are unusually high or low (none ${range}, 1.5 × IQR beyond the quartiles)${scope(filters)}.`;
    })(),
  };
}

function listRows(ctx: Ctx, spec: Extract<AnalysisSpec, { kind: 'rows' }>): Omit<Computation, 'sql' | 'steps'> {
  const columns = spec.columns.length ? spec.columns : ctx.info.columns.map((c) => c.name);
  const total = Number(run(ctx, buildCountSql(spec.filters, ctx.types), 'matching rows')[0]?.total ?? 0);
  const rows = run(ctx, buildSelectSql(columns, spec.filters, ctx.types, { orderBy: spec.sort, limit: spec.limit }), 'listed rows');
  const table = toTable(rows, spec.limit, columns);
  table.truncated = false;
  const facts = [fact('matching', 'Matching rows', total, formatInteger(total)), fact('shown', 'Rows shown', rows.length, formatInteger(rows.length))];
  return {
    result: table, facts, chart: null, warnings: [],
    summary: total === 0
      ? `No rows match${scope(spec.filters)}.`
      : `${formatInteger(total)} row${total === 1 ? '' : 's'} match${total === 1 ? 'es' : ''}${scope(spec.filters)}; showing ${rows.length}${spec.sort ? ` sorted by ${spec.sort.column} (${spec.sort.direction === 'desc' ? 'highest' : 'lowest'} first)` : ''}.`,
  };
}

function quality(ctx: Ctx, columns: string[]): Omit<Computation, 'sql' | 'steps'> {
  const info = ctx.info;
  const profiles = columns.length ? info.columns.filter((c) => columns.includes(c.name)) : info.columns;
  const rows = profiles.map((p) => ({ column: p.name, type: p.type, missing: p.missing, missing_pct: Number(p.missing_pct.toFixed(2)), distinct: p.distinct, unparseable: p.unparseable }))
    .sort((a, b) => b.missing - a.missing);
  const withMissing = rows.filter((r) => r.missing > 0);
  const facts = [
    fact('missing_cells', 'Missing cells', info.missing_cells, formatInteger(info.missing_cells), formatPercent((info.missing_cells / Math.max(1, info.row_count * info.column_count)) * 100, 2) + ' of all cells'),
    fact('columns_with_missing', 'Columns with gaps', withMissing.length, `${withMissing.length} of ${rows.length}`),
    fact('duplicate_rows', 'Duplicate rows', info.duplicate_rows, formatInteger(info.duplicate_rows)),
  ];
  const worst = withMissing[0];
  const chart = withMissing.length >= 2
    ? categoryChart(withMissing, 'column', 'missing_pct', { title: 'Missing values by column', xLabel: 'column', yLabel: '% missing', format: 'percent', preference: ctx.preference, sortedByValue: true })
    : null;
  ctx.steps.push({ step: 'read_profiles', ms: 0, detail: 'column profiles computed at import' });
  return {
    result: toTable(rows, 1000), facts, chart, warnings: [],
    summary: withMissing.length
      ? `${withMissing.length} of ${rows.length} columns have missing values. ${worst.column} has the most: ${formatInteger(worst.missing)} (${formatPercent(worst.missing_pct)}).${info.duplicate_rows ? ` ${formatInteger(info.duplicate_rows)} rows are exact duplicates.` : ''}`
      : `No missing values in ${rows.length === info.column_count ? 'any column' : 'the selected columns'}.${info.duplicate_rows ? ` ${formatInteger(info.duplicate_rows)} rows are exact duplicates.` : ''}`,
  };
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
