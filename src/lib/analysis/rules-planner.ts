import type { AnalysisTurn, ColumnProfile, DatasetInfo } from '../types';
import { primaryMetric } from './metric';
import type { Aggregation, AnalysisSpec, ChartPreference, Filter, Plan, TimeGrain } from './spec';

/**
 * Offline planner used when no language model is configured. It recognises a
 * fixed set of question patterns and maps them onto the same typed spec the
 * model produces, using only the real column names and values of the
 * dataset. Questions outside its patterns get an honest "unsupported" answer
 * that lists what it can do — it never guesses at an unrelated analysis.
 */

const words = (s: string) => s.toLowerCase().replace(/_/g, ' ');

function mentions(q: string, col: ColumnProfile): boolean {
  const name = words(col.name);
  const variants = new Set([name, col.name.toLowerCase(), name.endsWith('s') ? name.slice(0, -1) : `${name}s`, words(col.original_name)]);
  return [...variants].some((v) => v.length > 1 && new RegExp(`(^|[^\\p{L}\\p{N}])${escape(v)}($|[^\\p{L}\\p{N}])`, 'u').test(q));
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The position of a column's first mention, so "revenue by region" can tell the metric from the dimension. */
const position = (q: string, col: ColumnProfile) => {
  const i = q.indexOf(words(col.name));
  return i < 0 ? q.indexOf(col.name.toLowerCase()) : i;
};

function grainFrom(q: string): TimeGrain | null {
  if (/\b(daily|per day|by day|each day)\b/.test(q)) return 'day';
  if (/\b(weekly|per week|by week|each week)\b/.test(q)) return 'week';
  if (/\b(monthly|per month|by month|each month)\b/.test(q)) return 'month';
  if (/\b(quarterly|per quarter|by quarter|each quarter)\b/.test(q)) return 'quarter';
  if (/\b(yearly|annual|annually|per year|by year|each year)\b/.test(q)) return 'year';
  return null;
}

function aggFrom(q: string): Aggregation {
  if (/\b(average|avg|mean|typical)\b/.test(q)) return 'avg';
  if (/\b(maximum|max|largest single|biggest single)\b/.test(q)) return 'max';
  if (/\b(minimum|min|smallest single)\b/.test(q)) return 'min';
  return 'sum';
}

/** Category values named in the question ("in the North region", "for Electronics") become filters. */
function valueFilters(q: string, info: DatasetInfo, exclude: Set<string>): { filters: Filter[]; notes: string[] } {
  const filters: Filter[] = [];
  const notes: string[] = [];
  for (const col of info.columns) {
    if (exclude.has(col.name) || !['categorical', 'boolean'].includes(col.type)) continue;
    const hit = col.top_values.find((v) => v.value.length >= 3 && new RegExp(`(^|[^\\p{L}\\p{N}])${escape(v.value.toLowerCase())}($|[^\\p{L}\\p{N}])`, 'u').test(q));
    if (hit) { filters.push({ column: col.name, op: 'eq', value: hit.value, values: null }); notes.push(`Filtered to ${col.name} = ${hit.value}.`); }
  }
  const dateCol = info.columns.find((c) => c.type === 'date');
  const year = /\b(?:in|during|for)\s+((?:19|20)\d{2})\b/.exec(q);
  if (dateCol && year && !exclude.has(dateCol.name)) {
    filters.push({ column: dateCol.name, op: 'eq', value: year[1], values: null });
    notes.push(`Limited to ${dateCol.name} in ${year[1]}.`);
  }
  return { filters, notes };
}

export function planWithRules(question: string, info: DatasetInfo, _history: AnalysisTurn[] = []): Plan {
  const q = ` ${question.toLowerCase().replace(/[?!.]+/g, ' ').replace(/\s+/g, ' ')} `;
  const cols = info.columns;
  const numeric = cols.filter((c) => c.type === 'numeric');
  const dims = cols.filter((c) => c.type === 'categorical' || c.type === 'boolean');
  const dateCol = cols.find((c) => c.type === 'date');
  const mentioned = cols.filter((c) => mentions(q, c)).sort((a, b) => position(q, a) - position(q, b));
  const mNumeric = mentioned.filter((c) => c.type === 'numeric');
  const mDims = mentioned.filter((c) => c.type === 'categorical' || c.type === 'boolean');
  const assumptions: string[] = [];
  const chart: ChartPreference = /\b(table only|no chart)\b/.test(q) ? 'table'
    : /\bline chart\b/.test(q) ? 'line' : /\bbar chart\b/.test(q) ? 'bar' : /\bscatter\b/.test(q) ? 'scatter' : 'auto';

  const metric = mNumeric[0] ?? (() => {
    const guess = primaryMetric(cols);
    if (guess) assumptions.push(`No metric was named, so ${guess.name} was used.`);
    return guess;
  })();

  const analysis = (spec: AnalysisSpec, interpretation: string, extra: string[] = []): Plan => ({
    status: 'analysis', interpretation, assumptions: [...assumptions, ...extra], clarification_question: null,
    clarification_options: [], unsupported_reason: null, analysis: spec, chart,
  });

  // Ambiguous superlatives: "which is best?" with several possible metrics.
  if (/\b(best|worst|top performing|most successful)\b/.test(q) && !mNumeric.length && numeric.length > 1) {
    const dim = mDims[0] ?? dims[0];
    return {
      status: 'clarify',
      interpretation: '"Best" could be measured by several columns.',
      assumptions: [], unsupported_reason: null, analysis: null, chart,
      clarification_question: `Which measure should define "best"${dim ? ` for ${dim.name}` : ''}?`,
      clarification_options: numeric.slice(0, 3).map((n) => (dim ? `Which ${dim.name} has the highest total ${n.name}?` : `What is the total ${n.name}?`)),
    };
  }

  if (/\b(missing|null|nulls|empty|blank|data quality|quality issues?|duplicates?|incomplete)\b/.test(q)) {
    return analysis({ kind: 'quality', columns: mentioned.map((c) => c.name) }, 'Report missing values, unparseable values and duplicate rows for each column.');
  }

  if (/\b(correlat\w*|relationship|related|associat\w*)\b/.test(q)) {
    if (mNumeric.length === 2) {
      const [x, y] = mNumeric;
      return analysis({ kind: 'relationship', x: x.name, y: y.name, color_by: mDims[0]?.name ?? null, filters: [] }, `Plot ${y.name} against ${x.name} and measure how strongly they move together.`);
    }
    if (numeric.length >= 2) {
      const chosen = mNumeric.length > 2 ? mNumeric : numeric;
      return analysis({ kind: 'correlation', columns: chosen.map((c) => c.name), method: 'pearson', filters: [] }, `Pearson correlations between ${chosen.length} numeric columns.`, ['Pearson correlation measures linear association only.']);
    }
  }

  const target = mNumeric[0] ?? metric;
  if (/\b(outliers?|anomal\w*|unusual|extreme values?)\b/.test(q) && target) {
    const { filters, notes } = valueFilters(q, info, new Set());
    return analysis({ kind: 'outliers', column: target.name, filters }, `Find ${target.name} values outside 1.5 × the interquartile range.`, notes);
  }

  if (/\b(distribution|distributed|histogram|spread|range of)\b/.test(q)) {
    const col = mentioned[0] ?? target;
    if (col) {
      const { filters, notes } = valueFilters(q, info, new Set([col.name]));
      return analysis({ kind: 'distribution', column: col.name, filters }, `Show how ${col.name} values are distributed.`, notes);
    }
  }

  if (/\b(summary|summarize|summarise|describe|statistics|stats|overview)\b/.test(q)) {
    return analysis({ kind: 'describe', columns: mentioned.map((c) => c.name), filters: [] }, `Summary statistics for ${mentioned.length ? mentioned.map((c) => c.name).join(', ') : 'all columns'}.`);
  }

  const listing = /\b(?:show|list|find|which)\b.*?\b(?:the\s+)?(?:top\s+)?(\d{1,3})?\s*(largest|biggest|highest|smallest|lowest|most recent|latest|oldest)\s+(\d{1,3}\s+)?(orders|rows|records|transactions|entries|sales|items)\b/.exec(q);
  if (listing) {
    const n = Number(listing[1] ?? listing[3] ?? 10);
    const recency = /recent|latest|oldest/.test(listing[2]);
    const sortCol = recency ? dateCol : target;
    const { filters, notes } = valueFilters(q, info, new Set());
    return analysis({
      kind: 'rows', columns: [], filters, limit: Math.min(n, 100),
      sort: sortCol ? { column: sortCol.name, direction: /smallest|lowest|oldest/.test(listing[2]) ? 'asc' : 'desc' } : null,
    }, `List the ${n} rows with the ${listing[2]} ${sortCol?.name ?? 'values'}.`, notes);
  }

  const topN = /\b(?:top|bottom|first)\s+(\d{1,3})\b/.exec(q);
  const ascending = /\b(lowest|least|bottom|smallest|worst)\b/.test(q);

  // Shares: "what percentage of orders are refunded", "breakdown of status".
  if (/\b(share|percentage|percent|proportion|breakdown|split)\b/.test(q) && (mDims[0] || dims[0])) {
    const d = mDims[0] ?? dims.find((c) => /status|type|category|segment|state/i.test(c.name)) ?? dims[0];
    const useMetric = mNumeric[0];
    const { filters, notes } = valueFilters(q, info, new Set([d.name]));
    return analysis({
      kind: 'aggregate', dimensions: [{ column: d.name, time_grain: null }],
      measures: [useMetric ? { column: useMetric.name, agg: 'sum' } : { column: null, agg: 'count' }],
      filters, sort: null, limit: null, include_share: true,
    }, `${useMetric ? `Total ${useMetric.name}` : 'Row count'} and share of the total for each ${d.name}.`, notes);
  }

  // Counting: "how many orders per region", "number of distinct customers".
  if (/\b(how many|number of|count)\b/.test(q)) {
    const distinctCol = /\b(unique|distinct|different)\b/.test(q) ? mentioned.find((c) => c.type !== 'numeric' || mentioned.length === 1) : undefined;
    const groupBy = mDims.find((c) => c !== distinctCol);
    const timeGrain = grainFrom(q);
    const dimensions = [
      ...(groupBy && /\b(by|per|each|for each|across)\b/.test(q) ? [{ column: groupBy.name, time_grain: null }] : []),
      ...(dateCol && (timeGrain || /\bover time\b/.test(q)) ? [{ column: dateCol.name, time_grain: timeGrain }] : []),
    ];
    const { filters, notes } = valueFilters(q, info, new Set(dimensions.map((d) => d.column)));
    const measure = distinctCol ? { column: distinctCol.name, agg: 'count_distinct' as const } : { column: null, agg: 'count' as const };
    return analysis({ kind: 'aggregate', dimensions, measures: [measure], filters, sort: null, limit: null, include_share: false },
      `${distinctCol ? `Distinct ${distinctCol.name}` : 'Number of rows'}${dimensions.length ? ` by ${dimensions.map((d) => d.column).join(' and ')}` : ''}.`, notes);
  }

  if (!metric) {
    return unsupported(info, 'This dataset has no numeric columns to total or average.');
  }

  // Trends: "how has revenue changed over time", "monthly profit".
  const grain = grainFrom(q);
  if (dateCol && (grain || /\b(over time|trend|trends|growth|grow|change|changed|evolve|evolved|history|timeline|seasonal\w*)\b/.test(q))) {
    const agg = aggFrom(q);
    const split = mDims[0] && /\b(by|per|each|across)\b/.test(q) ? mDims[0] : undefined;
    const { filters, notes } = valueFilters(q, info, new Set([dateCol.name, ...(split ? [split.name] : [])]));
    return analysis({
      kind: 'aggregate',
      dimensions: [{ column: dateCol.name, time_grain: grain }, ...(split ? [{ column: split.name, time_grain: null }] : [])],
      measures: [{ column: metric.name, agg }], filters, sort: null, limit: null, include_share: false,
    }, `${agg === 'avg' ? 'Average' : agg === 'sum' ? 'Total' : agg === 'max' ? 'Maximum' : 'Minimum'} ${metric.name} per ${grain ?? 'period'} of ${dateCol.name}${split ? `, split by ${split.name}` : ''}.`, notes);
  }

  // Rankings and comparisons: "which category has the highest profit", "compare revenue by region".
  const groupDim = mDims[0];
  if (groupDim) {
    const agg = aggFrom(q);
    const { filters, notes } = valueFilters(q, info, new Set([groupDim.name]));
    return analysis({
      kind: 'aggregate', dimensions: [{ column: groupDim.name, time_grain: null }],
      measures: [{ column: metric.name, agg }], filters,
      sort: { by: 'measure', index: 0, direction: ascending ? 'asc' : 'desc' },
      limit: topN ? Number(topN[1]) : null, include_share: false,
    }, `${agg === 'avg' ? 'Average' : agg === 'sum' ? 'Total' : agg === 'max' ? 'Maximum' : 'Minimum'} ${metric.name} for each ${groupDim.name}${topN ? `, top ${topN[1]}` : ''}${ascending ? ', lowest first' : ''}.`, notes);
  }

  // A single overall number: "what is the total revenue", "average order value".
  if (/\b(total|sum|average|avg|mean|overall|maximum|minimum|max|min)\b/.test(q) && mNumeric.length) {
    const agg = aggFrom(q);
    const { filters, notes } = valueFilters(q, info, new Set());
    return analysis({ kind: 'aggregate', dimensions: [], measures: [{ column: metric.name, agg }], filters, sort: null, limit: null, include_share: false },
      `${agg === 'avg' ? 'Average' : agg === 'sum' ? 'Total' : agg === 'max' ? 'Maximum' : 'Minimum'} ${metric.name}${filters.length ? ' for the matching rows' : ''}.`, notes);
  }

  return unsupported(info, mentioned.length
    ? `The built-in planner could not work out what to compute for ${mentioned.map((c) => c.name).join(', ')}.`
    : 'The question does not mention any column in this dataset.');
}

function unsupported(info: DatasetInfo, reason: string): Plan {
  const numeric = info.columns.find((c) => c.type === 'numeric');
  const dim = info.columns.find((c) => c.type === 'categorical');
  const date = info.columns.find((c) => c.type === 'date');
  const examples = [
    numeric && dim ? `"Which ${dim.name} has the highest ${numeric.name}?"` : null,
    numeric && date ? `"How has ${numeric.name} changed over time?"` : null,
    numeric ? `"What is the distribution of ${numeric.name}?"` : null,
  ].filter(Boolean);
  return {
    status: 'unsupported',
    interpretation: '',
    assumptions: [],
    clarification_question: null,
    clarification_options: [],
    unsupported_reason: `${reason} Questions should refer to the dataset's columns (${info.columns.slice(0, 8).map((c) => c.name).join(', ')}${info.columns.length > 8 ? ', …' : ''})${examples.length ? `, for example ${examples.join(' or ')}` : ''}.`,
    analysis: null,
    chart: 'auto',
  };
}
