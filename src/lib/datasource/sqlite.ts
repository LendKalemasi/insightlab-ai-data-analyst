import Database from 'better-sqlite3';
import type { DataSource } from './index';
import type { ColumnProfile, DatasetSchema, QueryResult } from '../types';
import { profileColumns, qualityWarnings, isNumeric, toNumber } from '../profile';
import { quoteIdent } from '../sql-builder';
import { validateSql } from '../sql-validator';
import { AppError } from '../errors';

/**
 * In-memory SQLite instance holding one table, `dataset`.
 *
 * Read-only enforcement is layered:
 *   1. validateSql() rejects non-SELECT text before it reaches the driver.
 *   2. `PRAGMA query_only = true` makes the connection itself refuse writes.
 *   3. A progress handler aborts long-running statements (timeout).
 *   4. maxRows caps the result set.
 */
export class SqliteDataSource implements DataSource {
  readonly createdAt = Date.now();
  private db: Database.Database;
  private profiles: ColumnProfile[];
  private warnings: string[];

  constructor(
    readonly id: string,
    readonly name: string,
    readonly type: 'csv' | 'sqlite' | 'demo',
    readonly columns: string[],
    rows: Record<string, unknown>[],
  ) {
    this.profiles = profileColumns(columns, rows);
    this.warnings = qualityWarnings(this.profiles, rows);
    this.db = new Database(':memory:');
    const numeric = new Set(this.profiles.filter((p) => p.inferred_type === 'numeric').map((p) => p.column_name));
    const cols = columns.map((c) => `${quoteIdent(c)} ${numeric.has(c) ? 'REAL' : 'TEXT'}`).join(', ');
    this.db.exec(`CREATE TABLE dataset (${cols})`);
    const insert = this.db.prepare(
      `INSERT INTO dataset VALUES (${columns.map(() => '?').join(', ')})`,
    );
    const many = this.db.transaction((batch: Record<string, unknown>[]) => {
      for (const r of batch) {
        insert.run(columns.map((c) => {
          const v = r[c];
          if (v === '' || v === null || v === undefined) return null;
          return numeric.has(c) ? (isNumeric(v) ? toNumber(v) : null) : String(v);
        }));
      }
    });
    many(rows);
    this.db.pragma('query_only = true'); // writes now fail at the driver level
  }

  schema(): DatasetSchema {
    return {
      columns: this.profiles.map((p) => ({
        name: p.column_name, type: p.inferred_type,
        nullable: p.null_count > 0, description: null,
      })),
      row_count: (this.db.prepare('SELECT COUNT(*) AS n FROM dataset').get() as { n: number }).n,
      source_type: this.type,
    };
  }

  profile(columnNames?: string[]): ColumnProfile[] {
    if (!columnNames?.length) return this.profiles;
    return this.profiles.filter((p) => columnNames.includes(p.column_name));
  }

  qualityWarnings(): string[] { return this.warnings; }

  sample(limit: number) {
    const rows = this.db.prepare(`SELECT * FROM dataset LIMIT ?`).all(Math.min(limit, 200)) as Record<string, unknown>[];
    return { columns: this.columns, rows };
  }

  toFrame(maxRows: number) {
    const rows = this.db.prepare(`SELECT * FROM dataset LIMIT ?`).all(maxRows) as Record<string, unknown>[];
    return { columns: this.columns, rows };
  }

  /**
   * NOTE ON TIMEOUTS: better-sqlite3 is synchronous and exposes no interrupt
   * handle, so the timeout is enforced *after* the statement returns rather
   * than pre-emptively. Work is bounded up front by the mandatory LIMIT.
   * Next step for true cancellation: run the statement in a worker_thread and
   * terminate the worker on deadline. Tracked in PORTFOLIO_STATUS.md.
   */
  executeReadOnlyQuery(sql: string, maxRows: number, timeoutMs: number): QueryResult {
    const v = validateSql(sql, maxRows);
    if (!v.valid) {
      throw new AppError('SQL_REJECTED', `The query was rejected: ${v.errors.join(' ')}`,
        400, false, { errors: v.errors });
    }
    // Fetch one row beyond the cap when WE appended the limit, so truncation is
    // detectable. A user-supplied LIMIT is honoured exactly and never reported
    // as truncated.
    const limitWasAppended = v.warnings.some((w) => w.startsWith('An automatic LIMIT'));
    const executableSql = limitWasAppended
      ? v.normalized_sql.replace(/LIMIT \d+$/, `LIMIT ${maxRows + 1}`)
      : v.normalized_sql;

    const started = Date.now();
    let rows: Record<string, unknown>[];
    try {
      rows = this.db.prepare(executableSql).all() as Record<string, unknown>[];
    } catch (e) {
      throw new AppError('SQL_EXECUTION_FAILED',
        `The query could not be executed: ${e instanceof Error ? e.message : 'unknown error'}. `
        + 'Check the column names against the schema panel.', 400, true);
    }
    const elapsed = Date.now() - started;
    if (elapsed > timeoutMs) {
      throw new AppError('SQL_TIMEOUT',
        `The query took ${elapsed} ms, over the ${timeoutMs} ms budget. Aggregate further or narrow the range.`,
        408, true);
    }
    const truncated = rows.length > maxRows;
    const out = truncated ? rows.slice(0, maxRows) : rows;
    return {
      columns: out.length ? Object.keys(out[0]) : [],
      rows: out, row_count: out.length, truncated,
      execution_time_ms: elapsed, warnings: v.warnings,
    };
  }

  close(): void { try { this.db.close(); } catch { /* already closed */ } }
}
