import { z } from 'zod';

export const ColumnKind = z.enum(['numeric', 'date', 'categorical', 'identifier', 'text']);
export type ColumnKind = z.infer<typeof ColumnKind>;

export const ColumnProfile = z.object({
  column_name: z.string(),
  inferred_type: ColumnKind,
  null_count: z.number().int(),
  null_percentage: z.number(),
  unique_count: z.number().int(),
  sample_values: z.array(z.string()),
  statistics: z.object({
    min: z.union([z.number(), z.string()]).nullable(),
    max: z.union([z.number(), z.string()]).nullable(),
    mean: z.number().nullable(),
  }),
});
export type ColumnProfile = z.infer<typeof ColumnProfile>;

export const DatasetSchema = z.object({
  columns: z.array(z.object({
    name: z.string(), type: ColumnKind, nullable: z.boolean(),
    description: z.string().nullable(),
  })),
  row_count: z.number().int(),
  source_type: z.enum(['csv', 'sqlite', 'demo']),
});
export type DatasetSchema = z.infer<typeof DatasetSchema>;

export const QueryResult = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.unknown())),
  row_count: z.number().int(),
  truncated: z.boolean(),
  execution_time_ms: z.number(),
  warnings: z.array(z.string()),
});
export type QueryResult = z.infer<typeof QueryResult>;

/** Structured plan. SQL is built FROM this object, never from raw user text. */
export const AnalysisPlan = z.object({
  question: z.string(),
  interpretation: z.string(),
  analysis_type: z.enum(['descriptive', 'comparative', 'diagnostic', 'trend',
    'distribution', 'segmentation', 'correlation', 'quality', 'unsupported']),
  required_columns: z.array(z.string()),
  steps: z.array(z.object({
    step_number: z.number().int(),
    purpose: z.string(),
    tool: z.enum(['schema', 'sql', 'python', 'chart', 'none']),
    description: z.string(),
  })),
  /** Typed operation the SQL builder consumes. */
  operation: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('trend'), date_column: z.string(), metric: z.string(),
      agg: z.enum(['sum', 'avg', 'count']) }),
    z.object({ kind: z.literal('group'), dimension: z.string(), metric: z.string(),
      agg: z.enum(['sum', 'avg', 'count']), limit: z.number().int().min(1).max(200) }),
    z.object({ kind: z.literal('share'), dimension: z.string() }),
    z.object({ kind: z.literal('correlation'), columns: z.array(z.string()) }),
    z.object({ kind: z.literal('quality') }),
    z.object({ kind: z.literal('none') }),
  ]),
  needs_clarification: z.boolean(),
  clarification_question: z.string().nullable(),
  chart_recommendation: z.object({
    should_create: z.boolean(),
    chart_type: z.enum(['line', 'bar', 'area', 'scatter', 'histogram', 'box', 'table', 'none']),
    x_column: z.string().nullable(),
    y_columns: z.array(z.string()),
    group_by: z.string().nullable(),
  }),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type AnalysisPlan = z.infer<typeof AnalysisPlan>;

export const TraceEvent = z.object({
  tool: z.string(),
  status: z.enum(['ok', 'skipped', 'error']),
  duration_ms: z.number(),
  detail: z.string(),
});
export type TraceEvent = z.infer<typeof TraceEvent>;

export const AnalysisResult = z.object({
  analysis_id: z.string(),
  plan: AnalysisPlan,
  answer: z.string(),
  key_findings: z.array(z.string()),
  sql: z.string().nullable(),
  python: z.string().nullable(),
  python_executed: z.boolean(),
  result: QueryResult.nullable(),
  chart: z.object({
    chart_type: z.string(), x_column: z.string(), y_columns: z.array(z.string()),
    title: z.string(), x_label: z.string(), y_label: z.string(),
    accessibility_description: z.string(),
  }).nullable(),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
  trace: z.array(TraceEvent),
});
export type AnalysisResult = z.infer<typeof AnalysisResult>;

export const ApiError = z.object({
  error: z.object({
    code: z.string(), message: z.string(),
    details: z.record(z.unknown()), retryable: z.boolean(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const AskRequest = z.object({
  data_source_id: z.string().min(1).max(64),
  question: z.string().min(1).max(500),
  history: z.array(z.string().max(500)).max(20).default([]),
});
export const ValidateSqlRequest = z.object({
  sql: z.string().min(1).max(20000), data_source_id: z.string().min(1).max(64),
});
export const ExecuteSqlRequest = ValidateSqlRequest.extend({
  max_rows: z.number().int().min(1).max(5000).default(1000),
  timeout_ms: z.number().int().min(100).max(30000).default(10000),
});
