import { describe, expect, it } from 'vitest';
import { calendarYears, dateRange, eventErrors, missingTerms, startingYear, termErrors } from './calendarRules';

const term = (overrides = {}) => ({
  term: 1, opensOn: '04-01-2027', closesOn: '09-04-2027', halfTermStart: '19-02-2027', halfTermEnd: '28-02-2027', ...overrides,
});

describe('termErrors', () => {
  it('accepts a term with or without a half-term', () => {
    expect(termErrors(term(), 2027)).toEqual({});
    expect(termErrors(term({ halfTermStart: '', halfTermEnd: '' }), 2027)).toEqual({});
  });

  it('needs a term number and both dates, opening in the year shown', () => {
    expect(termErrors({ term: null, opensOn: '', closesOn: '' }, 2027)).toEqual({
      term: 'Choose term 1, 2 or 3',
      opensOn: 'Enter the day the term opens',
      closesOn: 'Enter the day the term closes',
    });
    expect(termErrors(term({ opensOn: '28-12-2026' }), 2027).opensOn).toBe('The term must open in 2027');
  });

  it('needs the term to close after it opens', () => {
    expect(termErrors(term({ closesOn: '04-01-2027', halfTermStart: '', halfTermEnd: '' }), 2027).closesOn).toBe('The term must close after it opens');
  });

  it('checks half-term is complete, in order and inside the term', () => {
    expect(termErrors(term({ halfTermEnd: '' }), 2027).halfTermEnd).toMatch(/last day of half-term/);
    expect(termErrors(term({ halfTermStart: '' }), 2027).halfTermStart).toMatch(/first day of half-term/);
    expect(termErrors(term({ halfTermEnd: '18-02-2027' }), 2027).halfTermEnd).toMatch(/end on or after/);
    expect(termErrors(term({ halfTermStart: '04-01-2027' }), 2027).halfTermStart).toBe('Half-term must fall inside the term');
    expect(termErrors(term({ halfTermEnd: '09-04-2027' }), 2027).halfTermStart).toBe('Half-term must fall inside the term');
  });
});

describe('eventErrors', () => {
  const event = (overrides = {}) => ({ kind: 'public_holiday', name: 'Madaraka Day', startsOn: '01-06-2027', endsOn: '', ...overrides });

  it('accepts a one-day holiday and a longer exam', () => {
    expect(eventErrors(event())).toEqual({});
    expect(eventErrors(event({ kind: 'national_exam', name: 'KCSE 2027', startsOn: '08-11-2027', endsOn: '26-11-2027' }))).toEqual({});
  });

  it('needs a national kind, a name and dates in order', () => {
    expect(eventErrors({ kind: 'school_closure', name: ' ', startsOn: '' })).toEqual({
      kind: 'Choose public holiday or national exam',
      name: 'Give it a name, for example Madaraka Day',
      startsOn: 'Enter the first day',
    });
    expect(eventErrors(event({ name: 'x'.repeat(121) })).name).toMatch(/120 characters/);
    expect(eventErrors(event({ endsOn: '31-05-2027' })).endsOn).toMatch(/end on or after/);
  });
});

describe('years and missing terms', () => {
  const terms = [
    { year: 2026, term: 1, opensOn: '05-01-2026', closesOn: '02-04-2026' },
    { year: 2026, term: 3, opensOn: '24-08-2026', closesOn: '23-10-2026' },
    { year: 2026, term: null, practice: true, opensOn: '02-11-2026', closesOn: '27-11-2026' },
    { year: 2024, term: 1, opensOn: '08-01-2024', closesOn: '05-04-2024' },
  ];

  it('offers every year with terms, plus this year and next', () => {
    expect(calendarYears(terms, new Date(2026, 10, 15))).toEqual([2024, 2026, 2027]);
  });

  it('opens on next year once this year\'s last term has closed', () => {
    expect(startingYear(terms, new Date(2026, 5, 1))).toBe(2026);
    expect(startingYear(terms, new Date(2026, 10, 15))).toBe(2027);
    expect(startingYear([], new Date(2026, 10, 15))).toBe(2026);
  });

  it('names the term numbers a year still needs, ignoring practice terms', () => {
    expect(missingTerms(terms, 2026)).toEqual([2]);
    expect(missingTerms(terms, 2027)).toEqual([1, 2, 3]);
  });

  it('shows a single day once', () => {
    expect(dateRange('01-06-2027', '01-06-2027')).toBe('01-06-2027');
    expect(dateRange('08-11-2027', '26-11-2027')).toBe('08-11-2027 to 26-11-2027');
  });
});
