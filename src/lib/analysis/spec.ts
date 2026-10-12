import { z } from 'zod';

/**
 * The typed analysis specification. A planner (the language model or the
 * rule-based fallback) only ever produces one of these objects; SQL and all
 * statistics are generated from it by deterministic code. User text and model
 * text never reach a query string.
 *
 * Every field is required (optional values are `null`) because the same
 * schema is sent to the model as a strict structured-output format.
 */

export const Scalar = z.union([z.string(), z.number(), z.boolean()]);

export const FilterOp = z.enum([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'not_in',
  'contains', 'starts_with', 'is_null', 'not_null',
]);

export const Filter = z.object({
  column: z.string().describe('Exact column name from the schema.'),
  op: FilterOp,
  value: Scalar.nullable().describe('Comparison value for eq/neq/gt/gte/lt/lte/contains/starts_with; null otherwise.'),
  values: z.array(Scalar).nullable().describe('Values for in/not_in, or [low, high] for between; null otherwise.'),
});
export type Filter = z.infer<typeof Filter>;

export const TimeGrain = z.enum(['day', 'week', 'month', 'quarter', 'year']);
export type TimeGrain = z.infer<typeof TimeGrain>;

export const Dimension = z.object({
  column: z.string(),
  time_grain: TimeGrain.nullable().describe('Only for date columns: bucket dates by this grain. null for non-date columns.'),
});

export const Aggregation = z.enum(['count', 'count_distinct', 'sum', 'avg', 'min', 'max']);
export type Aggregation = z.infer<typeof Aggregation>;

export const Measure = z.object({
  column: z.string().nullable().describe('Column to aggregate. null only with agg "count" to count rows.'),
  agg: Aggregation,
});
export type Measure = z.infer<typeof Measure>;

export const AggregateSpec = z.object({
  kind: z.literal('aggregate'),
  dimensions: z.array(Dimension).describe('0–2 grouping columns. Empty for a single overall number.'),
  measures: z.array(Measure).describe('1–4 aggregated values.'),
  filters: z.array(Filter),
  sort: z.object({
    by: z.enum(['measure', 'dimension']),
    index: z.number().int().describe('0-based index into measures or dimensions.'),
    direction: z.enum(['asc', 'desc']),
  }).nullable().describe('null = time order for time groupings, otherwise largest first.'),
  limit: z.number().int().nullable().describe('Keep only the first N groups after sorting (e.g. top 5). null = all.'),
  include_share: z.boolean().describe('Add each group\'s percentage of the overall total of the first measure (sum/count only).'),
});

export const DistributionSpec = z.object({
  kind: z.literal('distribution'),
  column: z.string(),
  filters: z.array(Filter),
});

export const CorrelationSpec = z.object({
  kind: z.literal('correlation'),
  columns: z.array(z.string()).describe('2–15 numeric columns. Empty = all numeric columns.'),
  method: z.enum(['pearson', 'spearman']),
  filters: z.array(Filter),
});

export const RelationshipSpec = z.object({
  kind: z.literal('relationship'),
  x: z.string().describe('Numeric column for the horizontal axis.'),
  y: z.string().describe('Numeric column for the vertical axis.'),
  color_by: z.string().nullable().describe('Optional categorical column with few values.'),
  filters: z.array(Filter),
});

export const DescribeSpec = z.object({
  kind: z.literal('describe'),
  columns: z.array(z.string()).describe('Columns to summarise. Empty = all columns.'),
  filters: z.array(Filter),
});

export const OutliersSpec = z.object({
  kind: z.literal('outliers'),
  column: z.string().describe('Numeric column to scan for unusual values.'),
  filters: z.array(Filter),
});

export const RowsSpec = z.object({
  kind: z.literal('rows'),
  columns: z.array(z.string()).describe('Columns to show. Empty = all.'),
  filters: z.array(Filter),
  sort: z.object({ column: z.string(), direction: z.enum(['asc', 'desc']) }).nullable(),
  limit: z.number().int().describe('Number of rows to list, at most 100.'),
});

export const QualitySpec = z.object({
  kind: z.literal('quality'),
  columns: z.array(z.string()).describe('Columns to report on. Empty = all.'),
});

export const AnalysisSpec = z.union([
  AggregateSpec, DistributionSpec, CorrelationSpec, RelationshipSpec,
  DescribeSpec, OutliersSpec, RowsSpec, QualitySpec,
]);
export type AnalysisSpec = z.infer<typeof AnalysisSpec>;
export type AggregateSpec = z.infer<typeof AggregateSpec>;
export type RowsSpec = z.infer<typeof RowsSpec>;

export const ChartPreference = z.enum(['auto', 'bar', 'line', 'area', 'scatter', 'histogram', 'table', 'none']);
export type ChartPreference = z.infer<typeof ChartPreference>;

/** What a planner returns. */
export const Plan = z.object({
  status: z.enum(['analysis', 'clarify', 'unsupported']),
  interpretation: z.string().describe('One sentence restating what will be computed, in plain language.'),
  assumptions: z.array(z.string()).describe('Assumptions made to resolve ambiguity (e.g. which column "sales" means). Empty if none.'),
  clarification_question: z.string().nullable().describe('When status is "clarify": the question to ask the user.'),
  clarification_options: z.array(z.string()).describe('When status is "clarify": 2–4 short follow-up questions the user could send instead. Otherwise empty.'),
  unsupported_reason: z.string().nullable().describe('When status is "unsupported": why this dataset cannot answer it.'),
  analysis: AnalysisSpec.nullable().describe('Required when status is "analysis"; null otherwise.'),
  chart: ChartPreference.describe('"auto" unless the user asked for a specific chart.'),
});
export type Plan = z.infer<typeof Plan>;
