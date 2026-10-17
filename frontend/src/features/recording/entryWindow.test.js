import { describe, expect, it } from 'vitest';
import { checkEntryWindow, lateReasonError, schoolDaysBetween } from './entryWindow';

// Thursday 8 October 2026, mid-morning
const now = new Date(2026, 9, 8, 9, 30);

describe('schoolDaysBetween', () => {
  it('counts Monday to Friday only', () => {
    expect(schoolDaysBetween(new Date(2026, 9, 5), now)).toBe(3);
    // Fri 2 Oct → Thu 8 Oct skips the weekend
    expect(schoolDaysBetween(new Date(2026, 9, 2), now)).toBe(4);
    expect(schoolDaysBetween(now, now)).toBe(0);
  });
});

describe('checkEntryWindow', () => {
  it('accepts today and up to 3 school days back', () => {
    expect(checkEntryWindow('08-10-2026', now)).toEqual({ future: false, late: false, schoolDays: 0 });
    expect(checkEntryWindow('05-10-2026', now)).toMatchObject({ late: false, schoolDays: 3 });
  });

  it('marks older dates as late', () => {
    expect(checkEntryWindow('02-10-2026', now)).toEqual({ future: false, late: true, schoolDays: 4 });
  });

  it('refuses future dates', () => {
    expect(checkEntryWindow('09-10-2026', now)).toMatchObject({ future: true, late: false });
  });

  it('ignores a missing date (reported as missing elsewhere)', () => {
    expect(checkEntryWindow('', now)).toEqual({ future: false, late: false, schoolDays: 0 });
  });
});

describe('lateReasonError', () => {
  it('needs a short reason of reasonable length', () => {
    expect(lateReasonError('')).toMatch(/reason/);
    expect(lateReasonError('  ok  ')).toMatch(/reason/);
    expect(lateReasonError('Register was at the head office')).toBeNull();
    expect(lateReasonError('x'.repeat(301))).toMatch(/300 characters/);
  });
});
