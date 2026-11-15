const clock = require('../utils/clock');
const { localDate } = require('../validation/entryWindow');
const { kenyaHolidays } = require('./kenyaHolidays');

/**
 * Shared school-calendar rules: the "to confirm" mark on estimated holidays, filling in a
 * year's public holidays, and what the calendar is missing.
 *
 * An estimated date (Eid al-Fitr before it is gazetted) is stored with " (to confirm)" at
 * the end of its name, so no schema change is needed. The API returns the plain name with
 * toConfirm: true; school devices get the plain name only (changesController), since
 * teachers have nothing to confirm. An administrator confirms by saving the date.
 */

const TO_CONFIRM = ' (to confirm)';
// From this day of the year, next year's terms are expected (the Ministry's circular
// usually comes in October or November)
const TERMS_REMINDER_FROM = '11-01';
// From this day of the year, next year's public holidays are filled in automatically
const PREFILL_FROM = '10-01';

const isToConfirm = (name) => typeof name === 'string' && name.endsWith(TO_CONFIRM);
const plainName = (name) => (isToConfirm(name) ? name.slice(0, -TO_CONFIRM.length) : name);
const storedName = (name, toConfirm) => (toConfirm ? `${plainName(name)}${TO_CONFIRM}` : plainName(name));

/**
 * Add the year's public holidays that are not in the calendar yet (matched by name, so
 * a holiday an administrator has moved or confirmed is left as it is).
 * Returns the holidays added: [{ id, name, date, toConfirm }].
 */
async function prefillHolidays(db, year, actorId = null) {
  const existing = (await db.query(
    `SELECT name FROM calendar_events
     WHERE school_id IS NULL AND kind = 'public_holiday' AND extract(year FROM starts_on) = $1`,
    [year]
  )).rows.map((r) => plainName(r.name).toLowerCase());
  const have = new Set(existing);
  const added = [];
  for (const holiday of kenyaHolidays(year)) {
    if (have.has(holiday.name.toLowerCase())) continue;
    const { id } = (await db.query(
      `INSERT INTO calendar_events (school_id, starts_on, ends_on, kind, name, created_by)
       VALUES (NULL, $1, $1, 'public_holiday', $2, $3) RETURNING id`,
      [holiday.date, storedName(holiday.name, holiday.toConfirm), actorId]
    )).rows[0];
    added.push({ id, ...holiday });
  }
  return added;
}

/**
 * What the calendar is missing, as of today in the schools' time zone:
 *   termsReminder   next year's national terms are not all entered and it is November or later
 *   missingTerms    next year's term numbers not entered
 *   toConfirm       estimated national holidays from this year on, not yet confirmed
 *   calendarEnded   no term (national or practice) closes today or later
 */
async function calendarStatus(db, now = clock.now()) {
  const today = localDate(now);
  const year = Number(today.slice(0, 4));
  const nextYear = year + 1;
  const terms = (await db.query(
    `SELECT year, term, practice, to_char(closes_on, 'YYYY-MM-DD') AS closes_on FROM school_terms`
  )).rows;
  const have = new Set(terms.filter((t) => !t.practice && t.year === nextYear).map((t) => t.term));
  const missingTerms = [1, 2, 3].filter((n) => !have.has(n));
  const toConfirm = (await db.query(
    `SELECT id, name, to_char(starts_on, 'YYYY-MM-DD') AS starts_on FROM calendar_events
     WHERE school_id IS NULL AND name LIKE $1 AND starts_on >= make_date($2, 1, 1)
     ORDER BY starts_on`,
    [`%${TO_CONFIRM}`, year]
  )).rows.map((e) => ({ id: e.id, name: plainName(e.name), startsOn: e.starts_on.split('-').reverse().join('-') }));
  return {
    today: today.split('-').reverse().join('-'),
    nextYear,
    missingTerms,
    termsReminder: missingTerms.length > 0 && today.slice(5) >= TERMS_REMINDER_FROM,
    toConfirm,
    calendarEnded: !terms.some((t) => t.closes_on >= today),
  };
}

/**
 * Fill in next year's public holidays once, from 1 October: only when that year has
 * none yet, so holidays an administrator removed are not put back.
 */
async function prefillNextYearIfDue(db, now = clock.now()) {
  const today = localDate(now);
  if (today.slice(5) < PREFILL_FROM) return null;
  const nextYear = Number(today.slice(0, 4)) + 1;
  const any = (await db.query(
    `SELECT 1 FROM calendar_events WHERE school_id IS NULL AND kind = 'public_holiday'
     AND extract(year FROM starts_on) = $1 LIMIT 1`,
    [nextYear]
  )).rows[0];
  if (any) return null;
  return { year: nextYear, added: await prefillHolidays(db, nextYear) };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Check twice a day while the API runs (CALENDAR_PREFILL=off turns it off). */
function startHolidayPrefill({ db, log = console } = {}) {
  if (String(process.env.CALENDAR_PREFILL || '').toLowerCase() === 'off') return null;
  const pool = db || require('../db/pool').pool;
  const pass = () => prefillNextYearIfDue(pool)
    .then((result) => {
      if (result) log.info(`School calendar: filled in ${result.added.length} public holidays for ${result.year}; an administrator should check them`);
    })
    .catch((error) => log.warn(`School calendar: could not fill in next year's holidays: ${error.message}`));
  const first = setTimeout(pass, 20 * 1000);
  const every = setInterval(pass, DAY_MS / 2);
  first.unref();
  every.unref();
  return { stop: () => { clearTimeout(first); clearInterval(every); } };
}

module.exports = {
  TO_CONFIRM, isToConfirm, plainName, storedName, prefillHolidays, calendarStatus, prefillNextYearIfDue, startHolidayPrefill,
};
