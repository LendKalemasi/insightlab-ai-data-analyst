import type { ColumnProfile, DatasetSchema, QueryResult } from '../types';

/**
 * Every data source implements this. The agent layer depends only on this
 * interface, so PostgreSQL/MySQL adapters can be added without touching the
 * planner, the SQL validator, or the orchestrator.
 */
export interface DataSource {
  readonly id: string;
  readonly name: string;
  readonly type: 'csv' | 'sqlite' | 'demo';
  readonly createdAt: number;
  schema(): DatasetSchema;
  profile(columnNames?: string[]): ColumnProfile[];
  qualityWarnings(): string[];
  sample(limit: number): { columns: string[]; rows: Record<string, unknown>[] };
  /** Must reject anything that is not a validated read-only SELECT. */
  executeReadOnlyQuery(sql: string, maxRows: number, timeoutMs: number): QueryResult;
  /** Row export for the Python analysis service. */
  toFrame(maxRows: number): { columns: string[]; rows: Record<string, unknown>[] };
  close(): void;
}

export interface DataSourceConfig {
  /** Present only for adapters that connect out. Never serialised to the client. */
  host?: string; port?: number; database?: string; user?: string; password?: string; ssl?: boolean;
}
