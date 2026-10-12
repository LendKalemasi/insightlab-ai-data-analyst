import { describe, expect, it } from 'vitest';
import { decodeText, detectDelimiter, parseCsv } from '@/lib/ingest/csv';
import { normalizeHeaders, sanitizeHeader } from '@/lib/ingest/headers';
import { finish, ingestFile } from '@/lib/ingest';
import { detectDayOrder, detectNumberFormat, normalizeColumn, parseDate, parseNumber } from '@/lib/ingest/values';

const limits = { maxRows: 1000, maxColumns: 50 };
const bytes = (s: string) => new TextEncoder().encode(s);

describe('csv parsing', () => {
  it('handles quotes, embedded delimiters, escaped quotes and CRLF', () => {
    const t = parseCsv(bytes('name,note\r\n"Smith, J","said ""hi"""\r\nLee,"multi\nline"\r\n'), limits);
    expect(t.headers).toEqual(['name', 'note']);
    expect(t.rows).toEqual([['Smith, J', 'said "hi"'], ['Lee', 'multi\nline']]);
  });

  it('detects semicolon and tab delimiters', () => {
    expect(detectDelimiter('a;b;c\n1;2;3\n')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2\n')).toBe('\t');
    expect(detectDelimiter('"x,y";b\n"1,2";3\n')).toBe(';');
  });

  it('pads short rows, ignores extra fields and reports it', () => {
    const t = parseCsv(bytes('a,b\n1\n2,3,4\n'), limits);
    expect(t.rows).toEqual([['1', ''], ['2', '3']]);
    expect(t.notes.join(' ')).toMatch(/different number of fields/);
  });

  it('rejects empty files, header-only files and unterminated quotes', async () => {
    expect(() => parseCsv(bytes('  \n'), limits)).toThrow(/empty/i);
    await expect(ingestFile(bytes('a,b\n'), 'x.csv', limits)).rejects.toThrow(/no data rows/i);
    expect(() => parseCsv(bytes('a,b\n"oops,1\n'), limits)).toThrow(/never closed/i);
  });

  it('enforces row and column limits', () => {
    expect(() => parseCsv(bytes(`a\n${'1\n'.repeat(20)}`), { maxRows: 5, maxColumns: 5 })).toThrow(/more than 5 rows/);
    expect(() => parseCsv(bytes('a,b,c,d\n1,2,3,4\n'), { maxRows: 5, maxColumns: 3 })).toThrow(/more than 3 columns/);
  });

  it('decodes Windows-1252 when the bytes are not UTF-8', () => {
    const latin = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in Windows-1252
    expect(decodeText(latin)).toEqual({ text: 'café', encoding: 'Windows-1252' });
  });

  it('rejects unsupported and disguised files by content', async () => {
    await expect(ingestFile(bytes('hello'), 'data.json', limits)).rejects.toThrow(/not supported/);
    await expect(ingestFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2]), 'old.xls', limits)).rejects.toThrow(/Legacy \.xls/);
    await expect(ingestFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]), 'data.csv', limits)).rejects.toThrow(/not CSV text/);
    await expect(ingestFile(bytes('not a zip'), 'book.xlsx', limits)).rejects.toThrow(/not an Excel workbook/);
  });
});

describe('headers', () => {
  it('makes headers query-safe and unique ignoring case', () => {
    expect(sanitizeHeader('Unit Price ($)', 0)).toBe('Unit Price');
    expect(sanitizeHeader('2024 sales', 0)).toBe('col_2024 sales');
    expect(sanitizeHeader('', 3)).toBe('column_4');
    expect(sanitizeHeader('Größe', 0)).toBe('Größe');
    expect(sanitizeHeader('rowid', 0)).toBe('rowid_col');
    const { names, notes } = normalizeHeaders(['Sales', 'sales', 'a"; DROP TABLE x --']);
    expect(names).toEqual(['Sales', 'sales_2', 'a_ DROP TABLE x']);
    expect(notes[0]).toMatch(/adjusted/);
  });
});

describe('value parsing', () => {
  it('parses currency, thousands separators, percents and accounting negatives', () => {
    const f = { decimalComma: false, percent: false };
    expect(parseNumber('$1,234.50', f)).toBe(1234.5);
    expect(parseNumber('(250)', f)).toBe(-250);
    expect(parseNumber('12%', f)).toBe(12);
    expect(parseNumber('1,5', f)).toBeNull();
    expect(parseNumber('abc', f)).toBeNull();
  });

  it('detects decimal commas per column', () => {
    const f = detectNumberFormat(['1,5', '2,25', '1.234,5']);
    expect(f.decimalComma).toBe(true);
    expect(parseNumber('1.234,5', f)).toBe(1234.5);
    expect(detectNumberFormat(['1,234', '5,678.9']).decimalComma).toBe(false);
  });

  it('normalises dates and decides day/month order from the data', () => {
    expect(parseDate('2024-03-05', 'mdy')).toBe('2024-03-05');
    expect(parseDate('2024-03-05T14:30:00', 'mdy')).toBe('2024-03-05 14:30:00');
    expect(parseDate('2024-02-30', 'mdy')).toBeNull();
    expect(detectDayOrder(['23/04/2024', '01/05/2024']).order).toBe('dmy');
    expect(parseDate('23/04/2024', 'dmy')).toBe('2024-04-23');
    expect(detectDayOrder(['03/04/2024']).ambiguous).toBe(true);
  });

  it('infers column types and counts unparseable values as missing', () => {
    const nums = normalizeColumn('revenue', 'revenue', ['10', '20.5', 'N/A', '', '1,000']);
    expect(nums.type).toBe('numeric');
    expect(nums.values).toEqual([10, 20.5, null, null, 1000]);

    const mixed = normalizeColumn('amount', 'amount', [...Array.from({ length: 99 }, (_, i) => String(i)), 'oops']);
    expect(mixed.type).toBe('numeric');
    expect(mixed.unparseable).toBe(1);

    expect(normalizeColumn('zip', 'zip', ['01234', '02345', '10001']).type).toBe('identifier');
    expect(normalizeColumn('customer_id', 'customer_id', ['1', '2', '3', '4']).type).toBe('identifier');
    expect(normalizeColumn('active', 'active', ['yes', 'no', 'Yes']).type).toBe('boolean');
    expect(normalizeColumn('day', 'day', ['2024-01-01', '2024-01-02']).type).toBe('date');
    expect(normalizeColumn('region', 'region', ['North', 'South', 'North']).type).toBe('categorical');
    expect(normalizeColumn('empty', 'empty', ['', 'NA']).type).toBe('text');
  });

  it('builds a full table through the shared pipeline', () => {
    const t = finish({ headers: ['When', 'Sales ($)'], rows: [['2024-01-01', '$10'], ['2024-01-02', '$20']], notes: [] }, 'csv', null);
    expect(t.columns.map((c) => [c.name, c.type])).toEqual([['When', 'date'], ['Sales', 'numeric']]);
    expect(t.columns[1].original_name).toBe('Sales ($)');
  });
});
