import { describe, expect, it } from 'vitest';
import { formatSecret, isCompleteCode, normaliseCode } from './totpFormat';

describe('formatSecret', () => {
  it('groups the secret in fours', () => {
    expect(formatSecret('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')).toBe('GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ');
    expect(formatSecret('ABCDEF')).toBe('ABCD EF');
    expect(formatSecret('')).toBe('');
  });
});

describe('normaliseCode', () => {
  it('keeps the digits only, up to 6', () => {
    expect(normaliseCode('123 456')).toBe('123456');
    expect(normaliseCode('12-34-5678')).toBe('123456');
    expect(normaliseCode('abc')).toBe('');
  });
});

describe('isCompleteCode', () => {
  it('needs exactly 6 digits', () => {
    expect(isCompleteCode('123456')).toBe(true);
    expect(isCompleteCode('12345')).toBe(false);
    expect(isCompleteCode('12345a')).toBe(false);
  });
});
