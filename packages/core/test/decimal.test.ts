import { describe, expect, it } from 'vitest';
import { Decimal, sum } from '../src/index.js';

describe('Decimal', () => {
  it('is exact where floating point is not', () => {
    expect(Decimal.from('0.1').add('0.2').toString()).toBe('0.3');
    expect(Decimal.from(0.1).add(0.2).eq('0.3')).toBe(true);
    expect(sum(['0.10', '0.20', '0.30']).toFixed(2)).toBe('0.60');
  });

  it('rounds half away from zero, as required for Imposta (00421)', () => {
    expect(Decimal.from('2.345').round(2).toFixed(2)).toBe('2.35');
    expect(Decimal.from('2.344').round(2).toFixed(2)).toBe('2.34');
    expect(Decimal.from('-2.345').round(2).toFixed(2)).toBe('-2.35');
    expect(Decimal.from('149.5978').toFixed(2)).toBe('149.60');
  });

  it('computes percentages with shift', () => {
    expect(Decimal.from('679.99').mul('22.00').shift(2).toFixed(2)).toBe('149.60');
  });

  it('formats a 2..8 decimal range', () => {
    expect(Decimal.from('1').toFixedRange(2, 8)).toBe('1.00');
    expect(Decimal.from('1.123456789').toFixedRange(2, 8)).toBe('1.12345679');
    expect(Decimal.from('1.5000').toFixedRange(2, 8)).toBe('1.50');
  });

  it('refuses ambiguous input', () => {
    expect(() => Decimal.from('1,5')).toThrow(RangeError);
    expect(() => Decimal.from('1e3')).toThrow(RangeError);
    expect(() => Decimal.from(1e21)).toThrow(RangeError);
    expect(() => Decimal.from(Number.NaN)).toThrow(RangeError);
    expect(() => Decimal.from('')).toThrow(RangeError);
  });
});
