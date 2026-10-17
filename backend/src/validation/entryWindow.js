/**
 * Entry window (#62): a record can be for the day it was captured or up to 3 school
 * days before. Older dates need a short reason (and are flagged for review); future
 * dates are refused. School days are Monday to Friday.
 *
 * The window is measured from when the record was captured on the device, not when it
 * reached the server, so a device that was offline for a week is not penalised.
 */

const clock = require('../utils/clock');

const LATE_AFTER_SCHOOL_DAYS = 3;
const MIN_REASON_LENGTH = 5;
const MAX_REASON_LENGTH = 300;

function schoolTimezone() {
  return process.env.SCHOOL_TIMEZONE || 'Africa/Nairobi';
}

/**
 * A moment as a calendar date (YYYY-MM-DD) in the schools' time zone.
 */
function localDate(moment, timeZone = schoolTimezone()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(moment);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function fromDisplayDate(date) {
  const [day, month, year] = date.split('-');
  return `${year}-${month}-${day}`;
}

/**
 * School days (Monday to Friday) after `fromIso`, up to and including `toIso`.
 */
function schoolDaysBetween(fromIso, toIso) {
  let count = 0;
  const day = new Date(`${fromIso}T00:00:00Z`);
  const end = new Date(`${toIso}T00:00:00Z`);
  while (day < end) {
    day.setUTCDate(day.getUTCDate() + 1);
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

/**
 * { error, late } for a record date (DD-MM-YYYY) captured at `capturedAt`.
 * A capture time later than now (a wrong device clock) counts as now.
 */
function checkEntryWindow(recordDate, { capturedAt, lateReason, now = clock.now() } = {}) {
  const recordIso = fromDisplayDate(recordDate);
  const today = localDate(now);
  if (recordIso > today) return { error: 'The date cannot be in the future', late: false };

  const captured = capturedAt && capturedAt < now ? capturedAt : now;
  const capturedIso = localDate(captured);
  const late = recordIso < capturedIso && schoolDaysBetween(recordIso, capturedIso) > LATE_AFTER_SCHOOL_DAYS;
  if (lateReason !== undefined && lateReason !== null && (typeof lateReason !== 'string' || lateReason.length > MAX_REASON_LENGTH)) {
    return { error: `The reason for a late entry must be text of at most ${MAX_REASON_LENGTH} characters`, late };
  }
  if (late && (typeof lateReason !== 'string' || lateReason.trim().length < MIN_REASON_LENGTH)) {
    return {
      error: `This date is more than ${LATE_AFTER_SCHOOL_DAYS} school days ago. Give a short reason for the late entry.`,
      late,
    };
  }
  return { error: null, late };
}

module.exports = {
  LATE_AFTER_SCHOOL_DAYS,
  schoolTimezone,
  localDate,
  schoolDaysBetween,
  checkEntryWindow,
};
