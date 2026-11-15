import { describe, expect, it } from 'vitest';
import { calendarEnded } from './planning';

const terms = [
  { year: 2026, term: 2, opensOn: '27-04-2026', closesOn: '31-07-2026' },
  { year: 2026, term: 3, opensOn: '24-08-2026', closesOn: '23-10-2026' },
];

describe('calendarEnded', () => {
  it('is false while a term is running, in the holidays before one, and on the last day', () => {
    expect(calendarEnded(terms, new Date(2026, 5, 1))).toBe(false);
    expect(calendarEnded(terms, new Date(2026, 7, 10))).toBe(false);
    expect(calendarEnded(terms, new Date(2026, 9, 23))).toBe(false);
  });

  it('is true once the last term has closed and no later term is on the device', () => {
    expect(calendarEnded(terms, new Date(2026, 9, 24))).toBe(true);
    expect(calendarEnded([], new Date(2026, 9, 24))).toBe(true);
  });

  it('is false again once next year\'s first term arrives', () => {
    const next = [...terms, { year: 2027, term: 1, opensOn: '04-01-2027', closesOn: '09-04-2027' }];
    expect(calendarEnded(next, new Date(2026, 10, 15))).toBe(false);
  });
});
