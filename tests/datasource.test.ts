import { describe, expect, it } from 'vitest';
import { SqliteDataSource } from '@/lib/datasource/sqlite';
import { DEMO_COLUMNS, generateDemoRows } from '@/lib/demo-data';

const make = () => new SqliteDataSource('ds_test', 'demo', 'demo', DEMO_COLUMNS,
  generateDemoRows() as unknown as Record<string, unknown>[]);

describe('SqliteDataSource', () => {
  it('loads the demo dataset deterministically', () => {
    const a = generateDemoRows(), b = generateDemoRows();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.length).toBeGreaterThan(500);
  });

  it('exposes a typed schema', () => {
    const ds = make();
    const s = ds.schema();
    expect(s.row_count).toBeGreaterThan(500);
    expect(s.columns.find((c) => c.name === 'revenue')!.type).toBe('numeric');
    expect(s.columns.find((c) => c.name === 'date')!.type).toBe('date');
    ds.close();
  });

  it('executes a read-only aggregation', () => {
    const ds = make();
    const r = ds.executeReadOnlyQuery('SELECT region, ROUND(SUM(revenue),2) AS total FROM dataset GROUP BY region', 100, 5000);
    expect(r.rows.length).toBeGreaterThan(1);
    expect(typeof r.rows[0].total).toBe('number');
    ds.close();
  });

  it('refuses mutating SQL before it reaches the driver', () => {
    const ds = make();
    expect(() => ds.executeReadOnlyQuery('DELETE FROM dataset', 10, 5000)).toThrowError(/rejected/i);
    expect(ds.schema().row_count).toBeGreaterThan(500);
    ds.close();
  });

  it('keeps the connection itself read-only', () => {
    const ds = make();
    // Second layer: even a statement that bypassed the validator would fail here.
    // @ts-expect-error reaching into the private handle on purpose for this test
    expect(() => ds.db.exec('DELETE FROM dataset')).toThrowError();
    ds.close();
  });

  it('truncates at the row limit and reports it', () => {
    const ds = make();
    const r = ds.executeReadOnlyQuery('SELECT * FROM dataset', 10, 5000);
    expect(r.row_count).toBe(10);
    expect(r.truncated).toBe(true);
    ds.close();
  });

  it('honours a user-supplied LIMIT without flagging truncation', () => {
    const ds = make();
    const r = ds.executeReadOnlyQuery('SELECT * FROM dataset LIMIT 3', 1000, 5000);
    expect(r.row_count).toBe(3);
    expect(r.truncated).toBe(false);
    ds.close();
  });

  it('reports a clear error for an unknown column', () => {
    const ds = make();
    expect(() => ds.executeReadOnlyQuery('SELECT nope FROM dataset', 10, 5000)).toThrowError(/could not be executed/i);
    ds.close();
  });
});
