import { describe, expect, it } from 'vitest';
import { maskDate, parseDisplayDate } from './DateField';

describe('maskDate', () => {
  it('inserts dashes as digits are typed', () => {
    expect(maskDate('1')).toBe('1');
    expect(maskDate('121')).toBe('12-1');
    expect(maskDate('12102')).toBe('12-10-2');
    expect(maskDate('12102026')).toBe('12-10-2026');
  });

  it('ignores anything that is not a digit and stops at 8 digits', () => {
    expect(maskDate('12/10/2026')).toBe('12-10-2026');
    expect(maskDate('12-10-20261')).toBe('12-10-2026');
    expect(maskDate('ab')).toBe('');
  });
});

describe('parseDisplayDate', () => {
  it('accepts real dates in DD-MM-YYYY', () => {
    expect(parseDisplayDate('12-10-2026')).toBe('12-10-2026');
    expect(parseDisplayDate('29-02-2028')).toBe('29-02-2028');
  });

  it('rejects impossible or incomplete dates', () => {
    expect(parseDisplayDate('31-02-2026')).toBeNull();
    expect(parseDisplayDate('29-02-2026')).toBeNull();
    expect(parseDisplayDate('12-13-2026')).toBeNull();
    expect(parseDisplayDate('12-10-20')).toBeNull();
    expect(parseDisplayDate('2026-10-12')).toBeNull();
  });
});
