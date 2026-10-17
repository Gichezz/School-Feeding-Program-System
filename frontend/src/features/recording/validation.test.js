import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { toCount, validateAttendance, validateMeals } from './validation';

const base = { schoolId: 'school-1', date: '12-10-2026' };

// The form checks the date against today (entry window, #62): pin today to the base date
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 12, 9, 0)); });
afterAll(() => vi.useRealTimers());

describe('toCount', () => {
  it('accepts whole numbers including 0', () => {
    expect(toCount('0')).toBe(0);
    expect(toCount(' 600 ')).toBe(600);
    expect(toCount(42)).toBe(42);
  });

  it('rejects blanks, negatives, decimals and text', () => {
    for (const value of ['', null, undefined, '-1', '2.5', 'abc', '1e3']) expect(toCount(value)).toBeNull();
  });
});

describe('validateAttendance', () => {
  it('passes when present + absent equals registered', () => {
    const { errors, check } = validateAttendance({ ...base, totalRegistered: '100', totalPresent: '94', totalAbsent: '6' });

    expect(errors).toEqual({});
    expect(check).toMatchObject({ ok: true, counted: 100, registered: 100 });
  });

  it('allows zero absent', () => {
    expect(validateAttendance({ ...base, totalRegistered: '50', totalPresent: '50', totalAbsent: '0' }).errors).toEqual({});
  });

  it('explains when learners are not counted', () => {
    const { errors, check } = validateAttendance({ ...base, totalRegistered: '100', totalPresent: '90', totalAbsent: '5' });

    expect(check.ok).toBe(false);
    expect(errors.totalAbsent).toMatch(/add up to 95; 5 of the 100 registered learners are not counted/);
  });

  it('uses the singular when one learner is not counted', () => {
    const { errors } = validateAttendance({ ...base, totalRegistered: '100', totalPresent: '94', totalAbsent: '5' });

    expect(errors.totalAbsent).toMatch(/1 of the 100 registered learners is not counted/);
  });

  it('explains when the count is more than registered', () => {
    const { errors } = validateAttendance({ ...base, totalRegistered: '100', totalPresent: '98', totalAbsent: '5' });

    expect(errors.totalAbsent).toMatch(/103, which is more than the 100 registered/);
  });

  it('reports missing and invalid fields', () => {
    const { errors, check } = validateAttendance({ schoolId: '', date: '', totalRegistered: '', totalPresent: '2.5', totalAbsent: '-1' });

    expect(Object.keys(errors).sort()).toEqual(['date', 'schoolId', 'totalAbsent', 'totalPresent', 'totalRegistered']);
    expect(errors.totalRegistered).toBe('Enter the number of registered learners');
    expect(errors.totalPresent).toMatch(/whole number/);
    expect(check).toBeNull();
  });
});

describe('validateMeals', () => {
  it('passes when served is at most prepared and reports the leftover', () => {
    const { errors, check } = validateMeals({ ...base, mealsPrepared: '600', mealsServed: '588' });

    expect(errors).toEqual({});
    expect(check).toMatchObject({ ok: true, leftover: 12 });
  });

  it('rejects more meals served than prepared', () => {
    const { errors } = validateMeals({ ...base, mealsPrepared: '100', mealsServed: '101' });

    expect(errors.mealsServed).toBe('Meals served (101) cannot be more than meals prepared (100)');
  });

  it('reports missing fields', () => {
    expect(Object.keys(validateMeals({ schoolId: '', date: '', mealsPrepared: '', mealsServed: '' }).errors).sort())
      .toEqual(['date', 'mealsPrepared', 'mealsServed', 'schoolId']);
  });
});

describe('entry window', () => {
  const counts = { totalRegistered: '100', totalPresent: '90', totalAbsent: '10' };

  it('refuses future dates', () => {
    expect(validateAttendance({ ...base, ...counts, date: '13-10-2026' }).errors).toEqual({ date: 'The date cannot be in the future' });
  });

  it('needs a reason for a date more than 3 school days ago', () => {
    // Tue 6 Oct is 4 school days before Mon 12 Oct
    const late = validateMeals({ ...base, date: '06-10-2026', mealsPrepared: '100', mealsServed: '90' });
    const explained = validateAttendance({ ...base, ...counts, date: '06-10-2026', lateReason: 'Register was at the head office' });

    expect(late.entry).toMatchObject({ late: true, schoolDays: 4 });
    expect(Object.keys(late.errors)).toEqual(['lateReason']);
    expect(explained.errors).toEqual({});
  });

  it('does not ask for a reason within the window', () => {
    const { errors, entry } = validateAttendance({ ...base, ...counts, date: '07-10-2026' });

    expect(entry.late).toBe(false);
    expect(errors).toEqual({});
  });
});
