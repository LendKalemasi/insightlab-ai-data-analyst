import { describe, expect, it } from 'vitest';
import { parseSampleLimit } from '@/lib/limits';

describe('request limits', () => {
  it('uses the default sample limit when omitted', () => {
    expect(parseSampleLimit(null)).toBe(20);
  });

  it('accepts only integer sample limits from 1 to 200', () => {
    expect(parseSampleLimit('1')).toBe(1);
    expect(parseSampleLimit('200')).toBe(200);
    expect(() => parseSampleLimit('NaN')).toThrowError(/integer/i);
    expect(() => parseSampleLimit('-1')).toThrowError(/integer/i);
    expect(() => parseSampleLimit('201')).toThrowError(/integer/i);
  });
});
