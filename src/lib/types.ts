/**
 * Domain types shared by the server and the browser. Type-only: importing this
 * file never pulls server code (SQLite, the Anthropic SDK) into the client bundle.
 */
import type { AnalysisSpec } from './analysis/spec';

export type { AnalysisSpec };

export type ColumnType = 'numeric' | 'date' | 'categorical' | 'boolean' | 'identifier' | 'text';
export type SourceKind = 'csv' | 'excel' | 'demo';

export interface HistogramBin { start: number; end: number; count: number }
export interface ValueCount { value: string; count: number }

export interface NumericStats {
  min: number; max: number; mean: number; median: number; std: number;
  p25: number; p75: number; sum: number;
  zeros: number; negatives: number;
  /** Values outside 1.5 × IQR of the quartiles. */
  outliers: number;
  histogram: HistogramBin[];
}

export interface DateStats {
  min: string; max: string;
  /** Distinct calendar months covered; drives the default time grain. */
  months: number;
  monthly: ValueCount[];
}

export interface ColumnProfile {
  name: string;
  /** Header exactly as it appeared in the file, before normalisation. */
  original_name: string;
  type: ColumnType;
  missing: number;
  missing_pct: number;
  distinct: number;
  /** Non-empty values that did not parse as the inferred type and were stored as missing. */
  unparseable: number;
  samples: string[];
  top_values: ValueCount[];
  numeric: NumericStats | null;
  date: DateStats | null;
  /** Assumptions made while parsing this column (e.g. day/month order). */
  notes: string[];
  /** Groups of values that differ only in case or spacing, e.g. ["North", "north"]. */
  variants: string[][];
}

export type QualitySeverity = 'info' | 'warning';
export interface QualityIssue {
  kind: 'missing' | 'duplicates' | 'constant' | 'high_cardinality' | 'negative' | 'outliers' | 'unparseable' | 'empty_column' | 'inconsistent_values';
  severity: QualitySeverity;
  column: string | null;
  message: string;
}

export interface DatasetInfo {
  id: string;
  name: string;
  source: SourceKind;
  file_name: string | null;
  sheet: string | null;
  created_at: string;
  expires_at: string;
  row_count: number;
  column_count: number;
  file_bytes: number | null;
  missing_cells: number;
  duplicate_rows: number;
  columns: ColumnProfile[];
  quality: QualityIssue[];
  /** What the importer changed or assumed (renamed headers, delimiter, skipped rows). */
  ingest_notes: string[];
}

export interface DatasetSummary {
  id: string; name: string; source: SourceKind; created_at: string; expires_at: string;
  row_count: number; column_count: number;
}

export interface RowsPage {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  offset: number;
  limit: number;
}

export interface ResultColumn { name: string; kind: 'number' | 'string' }
export interface TableResult {
  columns: ResultColumn[];
  rows: Record<string, unknown>[];
  row_count: number;
  truncated: boolean;
}

/** A number or statement computed deterministically from the data — never by the model. */
export interface Fact {
  id: string;
  label: string;
  value: number | string;
  display: string;
  detail?: string;
}

export type ChartType = 'bar' | 'hbar' | 'line' | 'area' | 'scatter' | 'histogram' | 'heatmap';
export type ValueFormat = 'number' | 'integer' | 'percent' | 'correlation';

export interface ChartSpec {
  type: ChartType;
  title: string;
  description: string;
  x: { key: string; label: string; kind: 'category' | 'time' | 'number' };
  y: { label: string; format: ValueFormat };
  series: { key: string; label: string }[];
  data: Record<string, unknown>[];
  /** Shown under the chart when the data was trimmed or folded for readability. */
  note: string | null;
  /** Heatmap only: row/column labels. */
  matrix?: { labels: string[]; values: (number | null)[][] };
  /** Scatter only: least-squares line through the plotted points. */
  trend?: { slope: number; intercept: number } | null;
}

export interface Narrative {
  headline: string;
  summary: string;
  insights: { text: string; columns: string[] }[];
  caveats: string[];
  follow_ups: string[];
}

export interface Grounding {
  checked: number;
  unverified: string[];
}

export interface Verification {
  status: 'match' | 'mismatch' | 'skipped' | 'unavailable';
  detail: string;
}

export interface TraceEvent {
  step: string;
  status: 'ok' | 'skipped' | 'error';
  duration_ms: number;
  detail: string;
}

export type PlannerKind = 'anthropic' | 'rules';
export type TurnStatus = 'answered' | 'clarification' | 'unsupported' | 'error';

export interface AnalysisTurn {
  id: string;
  dataset_id: string;
  question: string;
  created_at: string;
  duration_ms: number;
  status: TurnStatus;
  planner: { kind: PlannerKind; model: string | null };
  interpretation: string;
  assumptions: string[];
  clarification: { question: string; options: string[] } | null;
  spec: AnalysisSpec | null;
  columns_used: string[];
  sql: string | null;
  result: TableResult | null;
  facts: Fact[];
  computed_summary: string;
  chart: ChartSpec | null;
  narrative: Narrative | null;
  narrative_note: string | null;
  grounding: Grounding | null;
  verification: Verification | null;
  warnings: string[];
  trace: TraceEvent[];
  error: { code: string; message: string; retryable: boolean } | null;
}

export type AnalysisStage = 'planning' | 'querying' | 'interpreting';
export type AnalysisEvent =
  | { type: 'stage'; stage: AnalysisStage; message: string }
  | { type: 'turn'; turn: AnalysisTurn }
  | { type: 'error'; error: { code: string; message: string; retryable: boolean } };

export interface AppStatus {
  ai: {
    provider: PlannerKind;
    model: string | null;
    configured: boolean;
    /** Human-readable reason AI is not active, or a misconfiguration. */
    message: string | null;
  };
  crosscheck: { configured: boolean };
  limits: { max_upload_bytes: number; max_rows: number; retention_hours: number };
}

export interface ApiErrorBody {
  error: { code: string; message: string; retryable: boolean; details?: Record<string, unknown> };
}
