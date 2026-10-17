import { toDate } from '../../utils/format';

/**
 * Entry window (#62), the same rule the server applies: a record can be for today or up
 * to 3 school days before. Older dates need a short reason (an administrator reviews
 * them); future dates are refused. School days are Monday to Friday. Checking on the
 * device means staff are asked for the reason while recording, even offline.
 */

export const LATE_AFTER_SCHOOL_DAYS = 3;
export const MIN_REASON_LENGTH = 5;
export const MAX_REASON_LENGTH = 300;

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * School days (Monday to Friday) after `from`, up to and including `to`.
 */
export function schoolDaysBetween(from, to) {
  let count = 0;
  const day = startOfDay(from);
  const end = startOfDay(to);
  while (day < end) {
    day.setDate(day.getDate() + 1);
    const weekday = day.getDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

/**
 * { future, late, schoolDays } for a record date (DD-MM-YYYY) recorded at `now`.
 */
export function checkEntryWindow(displayDate, now = new Date()) {
  const date = toDate(displayDate);
  if (!date) return { future: false, late: false, schoolDays: 0 };
  const today = startOfDay(now);
  if (date > today) return { future: true, late: false, schoolDays: 0 };
  const schoolDays = schoolDaysBetween(date, today);
  return { future: false, late: schoolDays > LATE_AFTER_SCHOOL_DAYS, schoolDays };
}

/**
 * The error for the late-entry reason, or null when it is not needed or is fine.
 */
export function lateReasonError(reason) {
  const text = String(reason ?? '').trim();
  if (text.length < MIN_REASON_LENGTH) return 'Give a short reason for entering this date late';
  if (text.length > MAX_REASON_LENGTH) return `Keep the reason to ${MAX_REASON_LENGTH} characters or fewer`;
  return null;
}
