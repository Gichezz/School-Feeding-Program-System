const { pool } = require('../db/pool');
const { isUuid, isDisplayDate } = require('../validation/records');
const {
  isToConfirm, plainName, storedName, prefillHolidays, calendarStatus,
} = require('../services/calendar');

/**
 * The school calendar: national terms, public holidays and national exams, and a
 * school's own closures and events. Every school-day calculation (the feeding register,
 * food planning, analytics) reads these tables, and school devices download them whole
 * with every sync (changesController), so a change here reaches devices on their next sync.
 *
 * System administrators keep the national calendar: terms (with half-term) and public
 * holidays and national exams. They never see a school's own dates, which are school records.
 * Programme officers add closures and events for schools in their own sub-county.
 * Practice terms (016) are set up separately and are only listed here.
 */

const NATIONAL_KINDS = ['public_holiday', 'national_exam'];
const SCHOOL_KINDS = ['school_closure', 'school_event'];
const MAX_NAME = 120;
// A closure or exam period longer than a year is a typing mistake
const MAX_EVENT_DAYS = 366;

const DATE_ERROR = 'Use a real date in DD-MM-YYYY format, for example 04-01-2027';

class CalendarError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const toIso = (display) => display.split('-').reverse().join('-');
const toDisplay = (iso) => (iso ? iso.split('-').reverse().join('-') : null);
const daysBetween = (fromIso, toIsoDate) => (Date.parse(`${toIsoDate}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000;

const TERM_COLUMNS = `id, year, term, label, practice,
  to_char(opens_on, 'YYYY-MM-DD') AS opens_on, to_char(closes_on, 'YYYY-MM-DD') AS closes_on,
  to_char(half_term_start, 'YYYY-MM-DD') AS half_term_start, to_char(half_term_end, 'YYYY-MM-DD') AS half_term_end`;

const EVENT_COLUMNS = `e.id, e.school_id, e.kind, e.name, s.name AS school_name,
  to_char(e.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(e.ends_on, 'YYYY-MM-DD') AS ends_on`;

function termShape(t) {
  return {
    id: t.id,
    year: t.year,
    term: t.term,
    label: t.label || `Term ${t.term} ${t.year}`,
    practice: t.practice,
    opensOn: toDisplay(t.opens_on),
    closesOn: toDisplay(t.closes_on),
    halfTermStart: toDisplay(t.half_term_start),
    halfTermEnd: toDisplay(t.half_term_end),
  };
}

function eventShape(e) {
  return {
    id: e.id,
    kind: e.kind,
    // An estimated date (Eid before it is gazetted) waits for an administrator to confirm it
    name: plainName(e.name),
    toConfirm: isToConfirm(e.name),
    startsOn: toDisplay(e.starts_on),
    endsOn: toDisplay(e.ends_on),
    schoolId: e.school_id,
    schoolName: e.school_name || null,
  };
}

/** A DD-MM-YYYY date as YYYY-MM-DD, or a CalendarError naming the field. */
function dateField(value, label) {
  if (!isDisplayDate(value)) throw new CalendarError(`${label}: ${DATE_ERROR}`);
  return toIso(value);
}

/** Optional DD-MM-YYYY: empty means none. */
function optionalDate(value, label) {
  if (value === null || value === undefined || value === '') return null;
  return dateField(value, label);
}

/**
 * The checks the table constraints make (009), in words, plus: the term opens in its own
 * year and does not overlap another national term.
 * input: { year, term, opensOn, closesOn, halfTermStart, halfTermEnd } in DD-MM-YYYY.
 */
async function termValues(db, input, ignoreId = null) {
  const year = Number(input.year);
  const term = Number(input.term);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new CalendarError('Year must be a year such as 2027');
  if (![1, 2, 3].includes(term)) throw new CalendarError('Term must be 1, 2 or 3');
  const opens = dateField(input.opensOn, 'Opens');
  const closes = dateField(input.closesOn, 'Closes');
  if (Number(opens.slice(0, 4)) !== year) throw new CalendarError(`Term ${term} ${year} must open in ${year}`);
  if (closes <= opens) throw new CalendarError('The term must close after it opens');

  const halfStart = optionalDate(input.halfTermStart, 'Half-term starts');
  const halfEnd = optionalDate(input.halfTermEnd, 'Half-term ends');
  if (Boolean(halfStart) !== Boolean(halfEnd)) throw new CalendarError('Give both half-term dates, or neither');
  if (halfStart) {
    if (!(halfStart > opens && halfEnd < closes)) throw new CalendarError('Half-term must fall inside the term, after it opens and before it closes');
    if (halfEnd < halfStart) throw new CalendarError('Half-term must end on or after the day it starts');
  }

  const clash = (await db.query(
    `SELECT year, term FROM school_terms
     WHERE NOT practice AND ($3::uuid IS NULL OR id <> $3) AND opens_on <= $2 AND closes_on >= $1
     ORDER BY opens_on LIMIT 1`,
    [opens, closes, ignoreId]
  )).rows[0];
  if (clash) throw new CalendarError(`These dates overlap Term ${clash.term} ${clash.year}`);

  const taken = (await db.query(
    'SELECT 1 FROM school_terms WHERE year = $1 AND term = $2 AND ($3::uuid IS NULL OR id <> $3)',
    [year, term, ignoreId]
  )).rows[0];
  if (taken) throw new CalendarError(`Term ${term} ${year} is already in the calendar`, 409);

  return { year, term, opens, closes, halfStart, halfEnd };
}

/** The schools a programme officer may add dates for: those in their sub-county. */
async function officerSchool(db, user, schoolId) {
  if (!isUuid(schoolId)) throw new CalendarError('Choose a school');
  const school = (await db.query('SELECT id, sub_county FROM schools WHERE id = $1', [schoolId])).rows[0];
  if (!school || !user.subCounty || school.sub_county !== user.subCounty) throw new CalendarError('School not found', 404);
  return school.id;
}

/**
 * input: { kind, name, startsOn, endsOn, schoolId? }. Administrators add national dates;
 * programme officers add a closure or event for a school in their sub-county.
 */
async function eventValues(db, user, input) {
  const isAdmin = user.role === 'admin';
  const kinds = isAdmin ? NATIONAL_KINDS : SCHOOL_KINDS;
  if (!kinds.includes(input.kind)) {
    throw new CalendarError(isAdmin ? 'Choose public holiday or national exam' : 'Choose school closed or school event');
  }
  const name = typeof input.name === 'string' ? plainName(input.name.trim()).trim() : '';
  if (!name) throw new CalendarError('Give it a name, for example Madaraka Day');
  if (name.length > MAX_NAME) throw new CalendarError(`Keep the name to ${MAX_NAME} characters`);
  const starts = dateField(input.startsOn, 'Starts');
  const ends = input.endsOn ? dateField(input.endsOn, 'Ends') : starts;
  if (ends < starts) throw new CalendarError('It must end on or after the day it starts');
  if (daysBetween(starts, ends) >= MAX_EVENT_DAYS) throw new CalendarError('A date in the calendar cannot last more than a year');
  const schoolId = isAdmin ? null : await officerSchool(db, user, input.schoolId);
  return { kind: input.kind, name, starts, ends, schoolId };
}

/** The event if this user may change it: national for administrators, their sub-county's for officers. */
async function editableEvent(db, user, id) {
  if (!isUuid(id)) return null;
  const event = (await db.query(
    `SELECT e.id, e.school_id, s.sub_county FROM calendar_events e LEFT JOIN schools s ON s.id = e.school_id WHERE e.id = $1`,
    [id]
  )).rows[0];
  if (!event) return null;
  if (user.role === 'admin') return event.school_id === null ? event : null;
  return event.school_id !== null && user.subCounty && event.sub_county === user.subCounty ? event : null;
}

function handle(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof CalendarError) return res.status(error.statusCode).json({ error: error.message });
      return next(error);
    }
  };
}

/**
 * GET /api/calendar/terms → { terms } every term, national and practice, by date.
 */
const listTerms = handle(async (req, res) => {
  const rows = (await pool.query(`SELECT ${TERM_COLUMNS} FROM school_terms ORDER BY opens_on`)).rows;
  res.json({ terms: rows.map(termShape) });
});

/**
 * POST /api/calendar/terms { year, term, opensOn, closesOn, halfTermStart?, halfTermEnd? } → { term }
 */
const createTerm = handle(async (req, res) => {
  const v = await termValues(pool, req.body || {});
  const row = (await pool.query(
    `INSERT INTO school_terms (year, term, opens_on, closes_on, half_term_start, half_term_end)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${TERM_COLUMNS}`,
    [v.year, v.term, v.opens, v.closes, v.halfStart, v.halfEnd]
  )).rows[0];
  res.status(201).json({ term: termShape(row) });
});

async function nationalTerm(id) {
  if (!isUuid(id)) return null;
  const term = (await pool.query(`SELECT ${TERM_COLUMNS} FROM school_terms WHERE id = $1`, [id])).rows[0];
  if (!term) return null;
  if (term.practice) throw new CalendarError('A practice term cannot be changed here');
  return term;
}

/**
 * PATCH /api/calendar/terms/:id { any of year, term, opensOn, closesOn, halfTermStart, halfTermEnd } → { term }
 * halfTermStart and halfTermEnd null (or '') remove the half-term.
 */
const updateTerm = handle(async (req, res) => {
  const current = await nationalTerm(req.params.id);
  if (!current) return res.status(404).json({ error: 'Term not found' });
  const body = req.body || {};
  const pick = (key, value) => (Object.prototype.hasOwnProperty.call(body, key) ? body[key] : value);
  const v = await termValues(pool, {
    year: pick('year', current.year),
    term: pick('term', current.term),
    opensOn: pick('opensOn', toDisplay(current.opens_on)),
    closesOn: pick('closesOn', toDisplay(current.closes_on)),
    halfTermStart: pick('halfTermStart', toDisplay(current.half_term_start)),
    halfTermEnd: pick('halfTermEnd', toDisplay(current.half_term_end)),
  }, current.id);
  const row = (await pool.query(
    `UPDATE school_terms SET year = $2, term = $3, opens_on = $4, closes_on = $5, half_term_start = $6, half_term_end = $7
     WHERE id = $1 RETURNING ${TERM_COLUMNS}`,
    [current.id, v.year, v.term, v.opens, v.closes, v.halfStart, v.halfEnd]
  )).rows[0];
  return res.json({ term: termShape(row) });
});

/**
 * DELETE /api/calendar/terms/:id → 204
 * A term that schools have entered enrolment for stays: their records belong to it.
 */
const deleteTerm = handle(async (req, res) => {
  const current = await nationalTerm(req.params.id);
  if (!current) return res.status(404).json({ error: 'Term not found' });
  const used = (await pool.query('SELECT 1 FROM enrolment WHERE term_id = $1 LIMIT 1', [current.id])).rows[0];
  if (used) {
    throw new CalendarError('Schools have entered enrolment for this term, so it cannot be removed. Change its dates instead.', 409);
  }
  await pool.query('DELETE FROM school_terms WHERE id = $1', [current.id]);
  return res.status(204).end();
});

/**
 * GET /api/calendar/events?year= → { events }
 * Administrators: public holidays and national exams. Programme officers: those, and the
 * closures and events of schools in their sub-county.
 */
const listEvents = handle(async (req, res) => {
  const year = req.query.year === undefined || req.query.year === '' ? null : Number(req.query.year);
  if (year !== null && (!Number.isInteger(year) || year < 2000 || year > 2100)) throw new CalendarError('year must be a year such as 2027');
  const scope = req.user.role === 'admin'
    ? 'e.school_id IS NULL'
    : 'e.school_id IS NULL OR s.sub_county = $2';
  const rows = (await pool.query(
    `SELECT ${EVENT_COLUMNS} FROM calendar_events e LEFT JOIN schools s ON s.id = e.school_id
     WHERE (${scope})
       AND ($1::int IS NULL OR (extract(year FROM e.starts_on) <= $1 AND extract(year FROM e.ends_on) >= $1))
     ORDER BY e.starts_on, e.name`,
    req.user.role === 'admin' ? [year] : [year, req.user.subCounty]
  )).rows;
  res.json({ events: rows.map(eventShape) });
});

async function eventById(id) {
  return (await pool.query(
    `SELECT ${EVENT_COLUMNS} FROM calendar_events e LEFT JOIN schools s ON s.id = e.school_id WHERE e.id = $1`, [id]
  )).rows[0];
}

/**
 * POST /api/calendar/events { kind, name, startsOn, endsOn?, schoolId? } → { event }
 */
const createEvent = handle(async (req, res) => {
  const v = await eventValues(pool, req.user, req.body || {});
  const { id } = (await pool.query(
    `INSERT INTO calendar_events (school_id, starts_on, ends_on, kind, name, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [v.schoolId, v.starts, v.ends, v.kind, v.name, req.user.id]
  )).rows[0];
  res.status(201).json({ event: eventShape(await eventById(id)) });
});

/**
 * PATCH /api/calendar/events/:id { any of kind, name, startsOn, endsOn, schoolId } → { event }
 */
const updateEvent = handle(async (req, res) => {
  const editable = await editableEvent(pool, req.user, req.params.id);
  if (!editable) return res.status(404).json({ error: 'Date not found' });
  const current = await eventById(editable.id);
  const body = req.body || {};
  const pick = (key, value) => (Object.prototype.hasOwnProperty.call(body, key) ? body[key] : value);
  const v = await eventValues(pool, req.user, {
    kind: pick('kind', current.kind),
    name: pick('name', current.name),
    startsOn: pick('startsOn', toDisplay(current.starts_on)),
    endsOn: pick('endsOn', toDisplay(current.ends_on)),
    schoolId: pick('schoolId', current.school_id),
  });
  // An estimated date stays marked until an administrator confirms it (confirmed: true)
  const stillToConfirm = isToConfirm(current.name) && body.confirmed !== true;
  await pool.query(
    'UPDATE calendar_events SET school_id = $2, starts_on = $3, ends_on = $4, kind = $5, name = $6 WHERE id = $1',
    [current.id, v.schoolId, v.starts, v.ends, v.kind, storedName(v.name, stillToConfirm)]
  );
  return res.json({ event: eventShape(await eventById(current.id)) });
});

/**
 * DELETE /api/calendar/events/:id → 204
 */
const deleteEvent = handle(async (req, res) => {
  const editable = await editableEvent(pool, req.user, req.params.id);
  if (!editable) return res.status(404).json({ error: 'Date not found' });
  await pool.query('DELETE FROM calendar_events WHERE id = $1', [editable.id]);
  return res.status(204).end();
});

/**
 * POST /api/calendar/events/prefill { year } → { added }
 * Adds the year's public holidays that are not in the calendar yet, worked out by Lishe
 * (fixed dates, Easter, and an estimate of Eid al-Fitr marked to confirm).
 */
const prefillEvents = handle(async (req, res) => {
  const year = Number((req.body || {}).year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new CalendarError('Year must be a year such as 2027');
  const added = await prefillHolidays(pool, year, req.user.id);
  res.status(added.length ? 201 : 200).json({
    added: added.map((h) => ({ id: h.id, name: h.name, startsOn: toDisplay(h.date), toConfirm: h.toConfirm })),
  });
});

/**
 * GET /api/calendar/status → what the calendar is missing (services/calendar.js).
 * Programme officers see only whether the terms have run out.
 */
const getStatus = handle(async (req, res) => {
  const status = await calendarStatus(pool);
  if (req.user.role !== 'admin') return res.json({ today: status.today, calendarEnded: status.calendarEnded });
  return res.json(status);
});

module.exports = {
  prefillEvents, getStatus,
  listTerms, createTerm, updateTerm, deleteTerm, listEvents, createEvent, updateEvent, deleteEvent,
};
