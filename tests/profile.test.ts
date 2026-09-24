import { describe, expect, it } from 'vitest';
import { inferKind, profileColumns, qualityWarnings } from '@/lib/profile';

const rows = [
  { date: '2025-01-01', region: 'North', revenue: '100', note: 'a', flag: 'x' },
  { date: '2025-01-02', region: '', revenue: '200.5', note: 'b', flag: 'x' },
  { date: '2025-01-03', region: 'South', revenue: '50', note: 'c', flag: 'x' },
];
const cols = ['date', 'region', 'revenue', 'note', 'flag'];

describe('dataset profiling', () => {
  it('infers dates, numerics and categoricals', () => {
    const p = profileColumns(cols, rows);
    expect(p.find((x) => x.column_name === 'date')!.inferred_type).toBe('date');
    expect(p.find((x) => x.column_name === 'revenue')!.inferred_type).toBe('numeric');
    expect(p.find((x) => x.column_name === 'region')!.inferred_type).toBe('categorical');
  });

  it('treats high-cardinality id columns as identifiers', () => {
    expect(inferKind('customer_id', ['C1', 'C2', 'C3'], 3)).toBe('identifier');
  });

  it('parses currency and thousands separators as numeric', () => {
    expect(inferKind('amount', ['$1,200', '$980'], 2)).toBe('numeric');
  });

  it('counts nulls and computes statistics', () => {
    const p = profileColumns(cols, rows);
    const region = p.find((x) => x.column_name === 'region')!;
    expect(region.null_count).toBe(1);
    expect(region.null_percentage).toBeCloseTo(33.33, 1);
    const revenue = p.find((x) => x.column_name === 'revenue')!;
    expect(revenue.statistics.min).toBe(50);
    expect(revenue.statistics.max).toBe(200.5);
    expect(revenue.statistics.mean).toBeCloseTo(116.83, 1);
  });

  it('flags missing values and constant columns without mutating data', () => {
    const w = qualityWarnings(profileColumns(cols, rows), rows);
    expect(w.some((x) => x.includes('region'))).toBe(true);
    expect(w.some((x) => /flag is constant/.test(x))).toBe(true);
    expect(rows[1].region).toBe('');
  });
});
