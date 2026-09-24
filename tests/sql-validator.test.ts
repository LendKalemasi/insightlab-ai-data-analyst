import { describe, expect, it } from 'vitest';
import { statementCount, validateSql } from '@/lib/sql-validator';

describe('read-only SQL validation', () => {
  it('accepts a plain SELECT', () => {
    expect(validateSql('SELECT region, SUM(revenue) FROM dataset GROUP BY region').valid).toBe(true);
  });

  it('accepts a WITH query that ends in SELECT', () => {
    const v = validateSql('WITH t AS (SELECT 1 AS a) SELECT a FROM t');
    expect(v.valid).toBe(true);
  });

  it.each(['INSERT INTO dataset VALUES (1)', 'UPDATE dataset SET revenue = 0',
    'DELETE FROM dataset', 'DROP TABLE dataset', 'ALTER TABLE dataset ADD c TEXT',
    'CREATE TABLE x (a)', 'TRUNCATE TABLE dataset', 'ATTACH DATABASE "x" AS y',
    'PRAGMA query_only = false'])('rejects %s', (sql) => {
    expect(validateSql(sql).valid).toBe(false);
  });

  it('rejects stacked statements', () => {
    expect(validateSql('SELECT 1; DROP TABLE dataset').valid).toBe(false);
  });

  it('rejects comments used to smuggle a second statement', () => {
    expect(validateSql('SELECT 1 /* harmless */ ; DELETE FROM dataset').valid).toBe(false);
    expect(validateSql('SELECT 1 -- \n; DROP TABLE dataset').valid).toBe(false);
  });

  it('does not mistake a semicolon inside a string literal for stacking', () => {
    expect(statementCount("SELECT 'a;b' AS x")).toBe(1);
    expect(validateSql("SELECT 'a;b' AS x").valid).toBe(true);
  });

  it('appends a row limit when none is present', () => {
    expect(validateSql('SELECT * FROM dataset', 500).normalized_sql).toMatch(/LIMIT 500$/);
  });

  it('keeps an explicit limit', () => {
    expect(validateSql('SELECT * FROM dataset LIMIT 5').normalized_sql).toMatch(/LIMIT 5$/);
  });

  it('uses the AST parser and reports referenced tables', () => {
    const v = validateSql('SELECT region FROM dataset');
    expect(v.parser_used).toBe(true);
    expect(v.tables_referenced).toContain('dataset');
  });
});
