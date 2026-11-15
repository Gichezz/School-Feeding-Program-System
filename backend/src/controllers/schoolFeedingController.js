const { pool } = require('../db/pool');
const clock = require('../utils/clock');
const { ValidationError, NotFoundError } = require('../utils/errors');
const { isUuid } = require('../validation/records');
const { localDate } = require('../validation/entryWindow');
const { visibleSchool } = require('../services/schoolAccess');
const { chooseTerm, termLabel } = require('./analyticsController');

const toDisplay = (isoDate) => (isoDate ? isoDate.split('-').reverse().join('-') : null);

/**
 * Every weekday of the term for one school, with what its records say about it.
 * Read only: built from daily_feeding and the school calendar (school_terms,
 * calendar_events); it changes nothing.
 *
 *   kind  fed          a feeding record with learners fed
 *         not_fed      a record saying learners were not fed (reason given)
 *         not_recorded a school day so far with no record at all
 *         upcoming     a school day still to come this term
 *         holiday      a public holiday (name given)
 *         half_term    the half-term break
 *         closure      the school's own closure (name given)
 */
const TERM_DAYS = `
  SELECT to_char(d, 'YYYY-MM-DD') AS day,
         EXTRACT(ISODOW FROM d)::int AS weekday,
         (SELECT name FROM calendar_events e
           WHERE e.kind = 'public_holiday' AND d BETWEEN e.starts_on AND e.ends_on LIMIT 1) AS holiday,
         (SELECT name FROM calendar_events e
           WHERE e.kind = 'school_closure' AND e.school_id = $1 AND d BETWEEN e.starts_on AND e.ends_on LIMIT 1) AS closure,
         ($4::date IS NOT NULL AND d BETWEEN $4::date AND $5::date) AS half_term,
         f.feeding_happened, f.learners_fed, f.reason_code
  FROM generate_series($2::date, $3::date, interval '1 day') AS d
  LEFT JOIN daily_feeding f ON f.school_id = $1 AND f.feeding_date = d::date
  WHERE EXTRACT(ISODOW FROM d) < 6
  ORDER BY d`;

function dayKind(row, today) {
  if (row.holiday) return 'holiday';
  if (row.half_term) return 'half_term';
  if (row.closure) return 'closure';
  if (row.feeding_happened === true) return 'fed';
  if (row.feeding_happened === false) return 'not_fed';
  return row.day > today ? 'upcoming' : 'not_recorded';
}

/**
 * GET /api/schools/:id/feeding?termId=
 * One school's term day by day, for its programme officer or its own staff. Defaults to
 * the term running today (or the latest that has started).
 */
async function getSchoolFeeding(req, res, next) {
  try {
    const { id } = req.params;
    if (!isUuid(id)) throw new ValidationError('Invalid school ID format');
    const school = await visibleSchool(pool, req.user, id);
    if (!school) throw new NotFoundError('School not found');

    const today = localDate(clock.now());
    const term = await chooseTerm(req.query.termId, today);
    const rows = (await pool.query(TERM_DAYS, [
      school.id, term.opens_on, term.closes_on, term.half_term_start, term.half_term_end,
    ])).rows;
    const enrolled = (await pool.query(
      'SELECT SUM(learners)::int AS learners FROM enrolment WHERE school_id = $1 AND term_id = $2', [school.id, term.id]
    )).rows[0].learners;
    const terms = await pool.query(
      'SELECT id, year, term, label FROM school_terms WHERE opens_on <= $1 ORDER BY opens_on DESC LIMIT 6', [today]
    );

    const days = rows.map((row) => {
      const kind = dayKind(row, today);
      return {
        date: toDisplay(row.day),
        weekday: row.weekday,
        kind,
        ...(kind === 'fed' && { learnersFed: row.learners_fed }),
        ...(kind === 'not_fed' && { reason: row.reason_code }),
        ...(kind === 'holiday' && { name: row.holiday }),
        ...(kind === 'closure' && { name: row.closure }),
      };
    });
    const count = (kind) => days.filter((d) => d.kind === kind).length;
    const lastFed = [...days].reverse().find((d) => d.kind === 'fed');

    res.json({
      school: { id: school.id, name: school.name, subCounty: school.sub_county, programmeType: school.programme_type },
      term: {
        id: term.id, label: termLabel(term), opensOn: toDisplay(term.opens_on), closesOn: toDisplay(term.closes_on),
        closed: today > term.closes_on,
      },
      terms: terms.rows.map((t) => ({ id: t.id, label: termLabel(t) })),
      enrolled,
      days,
      summary: {
        schoolDays: count('fed') + count('not_fed') + count('not_recorded'),
        fed: count('fed'),
        notFed: count('not_fed'),
        notRecorded: count('not_recorded'),
        upcoming: count('upcoming'),
        lastFed: lastFed ? lastFed.date : null,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getSchoolFeeding };
