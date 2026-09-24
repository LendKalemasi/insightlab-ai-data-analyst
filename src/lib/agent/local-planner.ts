import type { AnalysisPlan, ColumnProfile } from '../types';
import type { LlmProvider, PlanInput } from './provider';

/**
 * Deterministic planner. No network, no API key, always available.
 *
 * It resolves the question against the *actual* schema of the loaded dataset:
 * columns are matched by name and inferred type, so the plan differs for every
 * dataset. It never returns a hardcoded analysis result — it only decides which
 * typed operation to run. All numbers come from executing that operation.
 *
 * Dataset values are never interpreted as instructions; only column *names* and
 * inferred types influence planning.
 */
export class LocalPlanner implements LlmProvider {
  readonly name = 'local';

  async plan(input: PlanInput): Promise<AnalysisPlan> {
    const q = input.question.toLowerCase();
    const P = input.profiles;
    const numeric = P.filter((p) => p.inferred_type === 'numeric');
    const categorical = P.filter((p) => p.inferred_type === 'categorical');
    const dateCol = P.find((p) => p.inferred_type === 'date');
    const mentioned = (p: ColumnProfile) => q.includes(p.column_name.toLowerCase().replace(/_/g, ' '))
      || q.includes(p.column_name.toLowerCase());

    const metric = numeric.find(mentioned)
      ?? numeric.find((p) => /revenue|sales|amount|total/i.test(p.column_name))
      ?? numeric[0];
    const dimension = categorical.find(mentioned) ?? categorical[0];

    // A question only maps onto this dataset if it names a column or carries an
    // analytical intent. Without either, the honest answer is "unsupported" —
    // falling through to an arbitrary group-by would invent an analysis the
    // user never asked for.
    const namesColumn = P.some(mentioned);
    const hasIntent = /\b(which|compare|versus|\bvs\b|top|highest|lowest|best|worst|most|least|total|sum|average|avg|mean|count|breakdown|distribution|rank|per|by |group|trend|over time)\b/.test(q);
    const relevant = namesColumn || hasIntent;
    const base = {
      question: input.question, required_columns: [] as string[],
      needs_clarification: false, clarification_question: null as string | null,
      assumptions: [] as string[], warnings: [] as string[],
    };
    const noChart = { should_create: false, chart_type: 'none' as const, x_column: null, y_columns: [], group_by: null };

    // Ambiguity check: a bare superlative with several candidate metrics.
    if (/^(what|which)\b.*\bbest\b/.test(q) && numeric.length > 1 && !numeric.some(mentioned)) {
      return {
        ...base, interpretation: 'The question does not say which metric defines "best".',
        analysis_type: 'unsupported', steps: [], operation: { kind: 'none' },
        needs_clarification: true,
        clarification_question: `Which metric should define "best" — ${numeric.slice(0, 3).map((n) => n.column_name).join(', ')}?`,
        chart_recommendation: noChart,
      };
    }

    if (/missing|null|data quality|suspicious|incomplete/.test(q)) {
      return {
        ...base, interpretation: 'Report per-column missing values, uniqueness and inferred types.',
        analysis_type: 'quality',
        steps: [{ step_number: 1, purpose: 'Read cached column profiles', tool: 'schema', description: 'No SQL is required; profiling statistics are already computed.' }],
        operation: { kind: 'quality' },
        assumptions: ['Statistics are computed over the raw dataset with no rows dropped or filled.'],
        chart_recommendation: noChart,
      };
    }

    if (/correlat|relationship between|related to/.test(q) && numeric.length > 1) {
      return {
        ...base, interpretation: 'Compute pairwise Pearson correlations between numeric columns.',
        analysis_type: 'correlation', required_columns: numeric.map((n) => n.column_name),
        steps: [{ step_number: 1, purpose: 'Correlate numeric columns', tool: 'python', description: 'Pandas .corr() over numeric columns.' }],
        operation: { kind: 'correlation', columns: numeric.map((n) => n.column_name) },
        assumptions: ['Pearson correlation measures linear association only.', 'Rows with missing values in a pair are excluded from that pair.'],
        warnings: ['Correlation does not establish causation.'],
        chart_recommendation: noChart,
      };
    }

    const statusCol = P.find((p) => /status|state|stage/i.test(p.column_name) && p.inferred_type === 'categorical');
    if (/cancel|refund|percentage of|share of|proportion/.test(q) && statusCol) {
      return {
        ...base, interpretation: `Distribution of rows across ${statusCol.column_name}.`,
        analysis_type: 'distribution', required_columns: [statusCol.column_name],
        steps: [{ step_number: 1, purpose: 'Count rows per status', tool: 'sql', description: 'GROUP BY with a percentage of the total.' }],
        operation: { kind: 'share', dimension: statusCol.column_name },
        assumptions: ['Percentages are of all rows in the dataset, not of distinct orders.'],
        chart_recommendation: { should_create: true, chart_type: 'bar', x_column: statusCol.column_name, y_columns: ['rows_count'], group_by: null },
      };
    }

    if (metric && dateCol && relevant && /over time|trend|monthly|by month|per month|growth|change/.test(q)) {
      const agg = /average|avg|mean/.test(q) ? 'avg' as const : 'sum' as const;
      const alias = `${agg}_${metric.column_name}`;
      return {
        ...base, interpretation: `${agg === 'avg' ? 'Average' : 'Total'} ${metric.column_name} per calendar month of ${dateCol.column_name}.`,
        analysis_type: 'trend', required_columns: [dateCol.column_name, metric.column_name],
        steps: [
          { step_number: 1, purpose: 'Confirm column types', tool: 'schema', description: 'Check the date and metric columns exist.' },
          { step_number: 2, purpose: 'Aggregate by month', tool: 'sql', description: 'GROUP BY the year-month prefix of the date column.' },
          { step_number: 3, purpose: 'Plot the series', tool: 'chart', description: 'Line chart over months.' },
        ],
        operation: { kind: 'trend', date_column: dateCol.column_name, metric: metric.column_name, agg },
        assumptions: [
          `${metric.column_name} is aggregated by the calendar month of ${dateCol.column_name}.`,
          'All rows are included; no status filter is applied unless the question asks for one.',
        ],
        warnings: ['The first and last months may cover partial periods.'],
        chart_recommendation: { should_create: true, chart_type: 'line', x_column: 'month', y_columns: [alias], group_by: null },
      };
    }

    if (metric && dimension && relevant) {
      const avg = /average|avg|mean|per order/.test(q);
      const topMatch = /top\s*(\d{1,3})/.exec(q);
      const agg = avg ? 'avg' as const : 'sum' as const;
      const limit = topMatch ? Math.min(Number(topMatch[1]), 200) : 12;
      const alias = `${agg}_${metric.column_name}`;
      return {
        ...base,
        interpretation: `${avg ? 'Average' : 'Total'} ${metric.column_name} grouped by ${dimension.column_name}${topMatch ? `, top ${limit}` : ''}.`,
        analysis_type: /compare|versus|vs\b/.test(q) ? 'comparative' : 'segmentation',
        required_columns: [dimension.column_name, metric.column_name],
        steps: [
          { step_number: 1, purpose: 'Confirm column types', tool: 'schema', description: 'Check the dimension and metric columns exist.' },
          { step_number: 2, purpose: 'Aggregate by group', tool: 'sql', description: 'GROUP BY the dimension, ordered by the metric.' },
          { step_number: 3, purpose: 'Plot the ranking', tool: 'chart', description: 'Bar chart of groups.' },
        ],
        operation: { kind: 'group', dimension: dimension.column_name, metric: metric.column_name, agg, limit },
        assumptions: [
          `Rows with a missing ${dimension.column_name} are grouped under NULL rather than dropped.`,
          `${metric.column_name} is ${avg ? 'averaged' : 'summed'} across all matching rows.`,
        ],
        chart_recommendation: { should_create: true, chart_type: 'bar', x_column: dimension.column_name, y_columns: [alias], group_by: null },
      };
    }

    return {
      ...base,
      interpretation: 'The question does not map onto the columns available in this dataset.',
      analysis_type: 'unsupported', steps: [], operation: { kind: 'none' },
      warnings: [`Available columns: ${P.map((p) => p.column_name).join(', ')}.`],
      chart_recommendation: noChart,
    };
  }
}
