/**
 * Checks for the School calendar forms, the same as the server makes, so most mistakes
 * are shown before anything is sent. Dates are DD-MM-YYYY ('' while incomplete).
 */

export const EVENT_KINDS = [
  { value: 'public_holiday', label: 'Public holiday' },
  { value: 'national_exam', label: 'National exam' },
];
export const KIND_LABEL = {
  public_holiday: 'Public holiday',
  national_exam: 'National exam',
  school_closure: 'School closed',
  school_event: 'School event',
};
export const MAX_NAME = 120;

/** DD-MM-YYYY → YYYY-MM-DD, which sorts and compares as text. */
export const isoOf = (display) => (display ? display.split('-').reverse().join('-') : '');
const yearOf = (display) => Number(display.slice(6, 10));

/** "04-01-2027 to 09-04-2027", or one date when it is a single day. */
export function dateRange(from, to) {
  return !to || from === to ? from : `${from} to ${to}`;
}

/**
 * form: { term, opensOn, closesOn, halfTermStart, halfTermEnd }; year is the year shown.
 * Returns { field: message } for the fields that need changing.
 */
export function termErrors(form, year) {
  const errors = {};
  if (![1, 2, 3].includes(Number(form.term))) errors.term = 'Choose term 1, 2 or 3';
  if (!form.opensOn) errors.opensOn = 'Enter the day the term opens';
  else if (yearOf(form.opensOn) !== Number(year)) errors.opensOn = `The term must open in ${year}`;
  if (!form.closesOn) errors.closesOn = 'Enter the day the term closes';
  else if (form.opensOn && isoOf(form.closesOn) <= isoOf(form.opensOn)) errors.closesOn = 'The term must close after it opens';

  const { halfTermStart: start, halfTermEnd: end } = form;
  if (start && !end) errors.halfTermEnd = 'Enter the last day of half-term, or clear both half-term dates';
  if (end && !start) errors.halfTermStart = 'Enter the first day of half-term, or clear both half-term dates';
  if (start && end) {
    if (isoOf(end) < isoOf(start)) errors.halfTermEnd = 'Half-term must end on or after the day it starts';
    else if (form.opensOn && form.closesOn && !(isoOf(start) > isoOf(form.opensOn) && isoOf(end) < isoOf(form.closesOn))) {
      errors.halfTermStart = 'Half-term must fall inside the term';
    }
  }
  return errors;
}

/** form: { kind, name, startsOn, endsOn } */
export function eventErrors(form) {
  const errors = {};
  if (!EVENT_KINDS.some((k) => k.value === form.kind)) errors.kind = 'Choose public holiday or national exam';
  const name = (form.name || '').trim();
  if (!name) errors.name = 'Give it a name, for example Madaraka Day';
  else if (name.length > MAX_NAME) errors.name = `Keep the name to ${MAX_NAME} characters`;
  if (!form.startsOn) errors.startsOn = 'Enter the first day';
  if (form.endsOn && form.startsOn && isoOf(form.endsOn) < isoOf(form.startsOn)) errors.endsOn = 'It must end on or after the day it starts';
  return errors;
}

/**
 * The years to offer: every year with terms, this year and next year, newest last.
 */
export function calendarYears(terms, today = new Date()) {
  const thisYear = today.getFullYear();
  const years = new Set([thisYear, thisYear + 1]);
  for (const t of terms || []) if (!t.practice) years.add(t.year);
  return [...years].sort((a, b) => a - b);
}

/**
 * Which year to open on: next year once this year's last term has closed, otherwise this year.
 */
export function startingYear(terms, today = new Date()) {
  const thisYear = today.getFullYear();
  const todayIso = `${thisYear}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const thisYearTerms = (terms || []).filter((t) => !t.practice && t.year === thisYear);
  const lastClose = thisYearTerms.map((t) => isoOf(t.closesOn)).sort().pop();
  return lastClose && lastClose < todayIso ? thisYear + 1 : thisYear;
}

/** The national term numbers a year does not have yet. */
export function missingTerms(terms, year) {
  const have = new Set((terms || []).filter((t) => !t.practice && t.year === Number(year)).map((t) => t.term));
  return [1, 2, 3].filter((n) => !have.has(n));
}
