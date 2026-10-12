import { describe, expect, it } from 'vitest';
import { checkGrounding, extractNumbers } from '@/lib/analysis/grounding';
import { compileFilters, displaySql, quoteIdent } from '@/lib/query/sql';
import { maskQuoted, statementCount, validateSql } from '@/lib/query/validator';
import type { Fact, Narrative } from '@/lib/types';

describe('sql validator', () => {
  it.each([
    'DROP TABLE dataset', 'DELETE FROM dataset', 'UPDATE dataset SET x = 1', 'INSERT INTO dataset VALUES (1)',
    'ATTACH DATABASE "x" AS y', 'PRAGMA query_only = false', 'SELECT 1; DROP TABLE dataset',
    'SELECT 1 /* x */ ; DELETE FROM dataset', 'SELECT load_extension("x")', 'WITH a AS (SELECT 1) REPLACE INTO dataset VALUES (1)',
    "SELECT 'unterminated FROM dataset",
  ])('rejects %s', (sql) => {
    expect(validateSql(sql).valid).toBe(false);
  });

  it('allows keywords inside quoted identifiers and literals', () => {
    expect(validateSql('SELECT "Last Update", COUNT(*) FROM dataset GROUP BY 1').valid).toBe(true);
    expect(validateSql("SELECT * FROM dataset WHERE note = 'please drop; table'").valid).toBe(true);
    expect(validateSql("SELECT replace(name, 'a', 'b') FROM dataset").valid).toBe(true);
    expect(statementCount("SELECT 'a;b'")).toBe(1);
    expect(maskQuoted(`SELECT "x;y", 'it''s'`)).toBe(`SELECT "", ''`);
  });

  it('appends a LIMIT only when none is present', () => {
    expect(validateSql('SELECT * FROM dataset', { maxRows: 50 })).toMatchObject({ valid: true, limit_appended: true, sql: 'SELECT * FROM dataset\nLIMIT 50' });
    expect(validateSql('SELECT * FROM dataset LIMIT 5', { maxRows: 50 }).limit_appended).toBe(false);
  });
});

describe('sql builder', () => {
  it('quotes identifiers and refuses unsafe ones', () => {
    expect(quoteIdent('Unit Price')).toBe('"Unit Price"');
    expect(() => quoteIdent('revenue"; DROP TABLE dataset --')).toThrow(/unsafe identifier/i);
  });

  it('binds every value as a parameter', () => {
    const types = new Map([['region', 'categorical' as const], ['revenue', 'numeric' as const]]);
    const c = compileFilters([
      { column: 'region', op: 'eq', value: "x' OR 1=1 --", values: null },
      { column: 'revenue', op: 'between', value: null, values: [1, 2] },
      { column: 'region', op: 'contains', value: '50%_off', values: null },
    ], types);
    expect(c.sql).not.toContain('OR 1=1');
    expect(c.params).toEqual(["x' OR 1=1 --", 1, 2, '%50\\%\\_off%']);
    expect(displaySql(c)).toContain("'x'' OR 1=1 --'");
  });
});

describe('grounding check', () => {
  const facts: Fact[] = [
    { id: 'a', label: 'Total revenue', value: 1234567.89, display: '1,234,568' },
    { id: 'b', label: 'Change', value: 12.4, display: '+12.4%' },
  ];
  const n = (summary: string): Narrative => ({ headline: '', summary, insights: [], caveats: [], follow_ups: [] });

  it('parses written numbers with units and precision', () => {
    expect(extractNumbers('$1.2M and 12.4% and 3,400').map((m) => m.value)).toEqual([1_200_000, 12.4, 3400]);
  });

  it('accepts rounded mentions of computed values and flags invented ones', () => {
    expect(checkGrounding(n('Revenue reached $1.2M, up 12.4%.'), facts, null, '').unverified).toEqual([]);
    expect(checkGrounding(n('Revenue reached 1,234,568.'), facts, null, '').unverified).toEqual([]);
    expect(checkGrounding(n('Revenue grew 40% to $2.5M.'), facts, null, '').unverified).toEqual(['40%', '$2.5M']);
  });

  it('ignores small counts and years, and accepts numbers from the table and question', () => {
    const table = { columns: [{ name: 'v', kind: 'number' as const }], rows: [{ v: 845.5 }], row_count: 1, truncated: false };
    expect(checkGrounding(n('In 2025 the top 3 groups averaged 845.5 across 250 rows.'), facts, table, 'top 250 rows').unverified).toEqual([]);
  });
});
