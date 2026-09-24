import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv } from '@/lib/csv';

describe('CSV ingestion', () => {
  it('parses a valid CSV', () => {
    const p = parseCsv('a,b\n1,x\n2,y\n');
    expect(p.columns).toEqual(['a', 'b']);
    expect(p.rows).toEqual([{ a: '1', b: 'x' }, { a: '2', b: 'y' }]);
  });

  it('detects semicolon and tab delimiters', () => {
    expect(detectDelimiter('a;b;c')).toBe(';');
    expect(parseCsv('a;b\n1;2').columns).toEqual(['a', 'b']);
    expect(parseCsv('a\tb\n1\t2').columns).toEqual(['a', 'b']);
  });

  it('handles quoted fields containing delimiters and escaped quotes', () => {
    const p = parseCsv('name,note\n"Smith, J","He said ""hi"""');
    expect(p.rows[0]).toEqual({ name: 'Smith, J', note: 'He said "hi"' });
  });

  it('rejects an empty file', () => {
    expect(() => parseCsv('')).toThrowError(/empty/i);
  });

  it('rejects a header-only file', () => {
    expect(() => parseCsv('a,b')).toThrowError(/no data rows/i);
  });

  it('renames duplicate headers instead of dropping columns', () => {
    const p = parseCsv('a,a\n1,2');
    expect(p.columns).toEqual(['a', 'a_2']);
    expect(p.renamed_columns).toEqual(['a']);
  });

  it('strips a BOM and ignores blank lines', () => {
    expect(parseCsv('\uFEFFa,b\n1,2\n\n').columns).toEqual(['a', 'b']);
  });

  it('rejects unterminated quoted fields', () => {
    expect(() => parseCsv('a,b\n"unterminated,x')).toThrowError(/unterminated/i);
  });

  it('rejects headers that cannot be safely used as SQLite identifiers', () => {
    expect(() => parseCsv('customer-id,revenue\nC1,10')).toThrowError(/unsupported characters/i);
  });
});
