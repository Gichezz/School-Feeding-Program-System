const { pool } = require('../db/pool');
const clock = require('../utils/clock');
const { ValidationError, NotFoundError } = require('../utils/errors');
const { isUuid } = require('../validation/records');
const { localDate } = require('../validation/entryWindow');
const { subCountyFor } = require('../services/schoolAccess');

/**
 * Term analytics for programme officers: for each school in the sub-county, the term so
 * far as its records show it. Descriptive figures an officer can check against the
 * school's books; they rank nothing and decide nothing.
 *
 *   schoolDays     school days so far (weekdays in the term, less half-term, national
 *                  holidays and the school's own closures)
 *   recorded       days with a feeding record; fed / notFed (with the commonest reason);
 *                  missing = school days with no record at all
 *   coverage       mean learners fed on fed days, against the term's enrolment
 *   cereals/pulses food issued against the ration for learners fed (1.00 = as planned)
 *   daysOfFood     cereals in the store by the records, over the mean daily use of the
 *                  last 10 fed days
 *   deliveries     the first delivery of the term and how long after opening it came;
 *                  kilograms short of the delivery notes
 *   lastSync       when the school's records last reached the server; daysSinceSync
 *                  counts to the last day so far, so a school is not 'behind' in the holidays
 */

const RECENT_DAYS = 10;
const toDisplay = (isoDate) => (isoDate ? isoDate.split('-').reverse().join('-') : null);
// Dates as text, so no time zone can move them
const TERM_COLUMNS = `id, year, term, to_char(opens_on, 'YYYY-MM-DD') AS opens_on, to_char(closes_on, 'YYYY-MM-DD') AS closes_on,
  to_char(half_term_start, 'YYYY-MM-DD') AS half_term_start, to_char(half_term_end, 'YYYY-MM-DD') AS half_term_end`;

/** The term asked for, or the one running today, or the latest that has started. */
async function chooseTerm(termId, today) {
  if (termId !== undefined) {
    if (!isUuid(termId)) throw new ValidationError('Invalid term ID format');
    const term = (await pool.query(`SELECT ${TERM_COLUMNS} FROM school_terms WHERE id = $1`, [termId])).rows[0];
    if (!term) throw new NotFoundError('Term not found');
    return term;
  }
  const term = (await pool.query(
    `SELECT ${TERM_COLUMNS} FROM school_terms WHERE opens_on <= $1 ORDER BY opens_on DESC LIMIT 1`, [today]
  )).rows[0];
  if (!term) throw new NotFoundError('No term has started yet');
  return term;
}

const SCHOOL_FIGURES = `
  WITH days AS (
    SELECT d::date AS day
    FROM generate_series($2::date, $3::date, interval '1 day') AS d
    WHERE EXTRACT(ISODOW FROM d) < 6
      AND NOT ($4::date IS NOT NULL AND d BETWEEN $4::date AND $5::date)
      AND NOT EXISTS (SELECT 1 FROM calendar_events e
                      WHERE e.kind = 'public_holiday' AND d BETWEEN e.starts_on AND e.ends_on)
  ),
  school_days AS (
    SELECT s.id AS school_id, d.day
    FROM schools s CROSS JOIN days d
    WHERE s.sub_county = $1
      AND NOT EXISTS (SELECT 1 FROM calendar_events e
                      WHERE e.kind = 'school_closure' AND e.school_id = s.id AND d.day BETWEEN e.starts_on AND e.ends_on)
  ),
  feeding AS (
    SELECT f.* FROM daily_feeding f JOIN schools s ON s.id = f.school_id
    WHERE s.sub_county = $1 AND f.feeding_date BETWEEN $2::date AND $3::date
  ),
  recent AS (
    SELECT school_id, AVG(cereals_kg) AS cereals_per_day
    FROM (SELECT school_id, cereals_kg,
                 ROW_NUMBER() OVER (PARTITION BY school_id ORDER BY feeding_date DESC) AS n
          FROM feeding WHERE feeding_happened) r
    WHERE n <= ${RECENT_DAYS}
    GROUP BY school_id
  ),
  reasons AS (
    SELECT DISTINCT ON (school_id) school_id, reason_code
    FROM feeding WHERE NOT feeding_happened
    GROUP BY school_id, reason_code
    ORDER BY school_id, COUNT(*) DESC, reason_code
  )
  SELECT s.id AS school_id, s.name, s.programme_type,
         (SELECT COUNT(*) FROM school_days sd WHERE sd.school_id = s.id)::int AS school_days,
         (SELECT COUNT(*) FROM feeding f JOIN school_days sd ON sd.school_id = f.school_id AND sd.day = f.feeding_date
          WHERE f.school_id = s.id)::int AS recorded,
         (SELECT COUNT(*) FROM feeding f WHERE f.school_id = s.id AND f.feeding_happened)::int AS fed,
         (SELECT COUNT(*) FROM feeding f WHERE f.school_id = s.id AND NOT f.feeding_happened)::int AS not_fed,
         (SELECT reason_code FROM reasons r WHERE r.school_id = s.id) AS main_reason,
         (SELECT SUM(learners)::int FROM enrolment e WHERE e.school_id = s.id AND e.term_id = $6) AS enrolled,
         (SELECT AVG(learners_fed)::float FROM feeding f WHERE f.school_id = s.id AND f.feeding_happened) AS mean_fed,
         (SELECT SUM(cereals_kg)::float / NULLIF(SUM(learners_fed) * s.ration_cereals_g / 1000.0, 0)
          FROM feeding f WHERE f.school_id = s.id AND f.feeding_happened) AS cereals_vs_ration,
         (SELECT SUM(pulses_kg)::float / NULLIF(SUM(learners_fed) * s.ration_pulses_g / 1000.0, 0)
          FROM feeding f WHERE f.school_id = s.id AND f.feeding_happened) AS pulses_vs_ration,
         (SELECT SUM(quantity_kg)::float FROM stock_flows fl
          WHERE fl.school_id = s.id AND fl.commodity = 'cereals' AND fl.flow_date <= $3::date) AS cereals_in_store,
         (SELECT cereals_per_day::float FROM recent r WHERE r.school_id = s.id) AS cereals_per_day,
         (SELECT to_char(MIN(movement_date), 'YYYY-MM-DD') FROM stock_movements m
          WHERE m.school_id = s.id AND m.kind = 'delivery' AND m.movement_date BETWEEN $2::date AND $3::date) AS first_delivery,
         (SELECT COALESCE(SUM(GREATEST(note_quantity_kg - quantity_kg, 0)), 0)::float FROM stock_movements m
          WHERE m.school_id = s.id AND m.kind = 'delivery' AND m.movement_date BETWEEN $2::date AND $3::date) AS delivery_short_kg,
         (SELECT MAX(received_at) FROM daily_feeding f WHERE f.school_id = s.id) AS last_sync
  FROM schools s
  WHERE s.sub_county = $1
  ORDER BY s.name`;

function schoolFigures(row, opensOn, asOf) {
  const daysAfterOpening = row.first_delivery
    ? Math.round((Date.parse(row.first_delivery) - Date.parse(opensOn)) / 86400000)
    : null;
  return {
    schoolId: row.school_id,
    name: row.name,
    programmeType: row.programme_type,
    schoolDays: row.school_days,
    recorded: row.recorded,
    fed: row.fed,
    notFed: row.not_fed,
    missing: Math.max(row.school_days - row.recorded, 0),
    mainReason: row.main_reason,
    enrolled: row.enrolled,
    meanFed: row.mean_fed === null ? null : Math.round(row.mean_fed),
    coverage: row.enrolled && row.mean_fed !== null ? row.mean_fed / row.enrolled : null,
    cerealsVsRation: row.cereals_vs_ration,
    pulsesVsRation: row.pulses_vs_ration,
    cerealsInStoreKg: row.cereals_in_store === null ? null : Math.round(row.cereals_in_store),
    daysOfFood: row.cereals_per_day > 0 && row.cereals_in_store !== null
      ? Math.max(Math.floor(row.cereals_in_store / row.cereals_per_day), 0)
      : null,
    firstDelivery: toDisplay(row.first_delivery),
    deliveryDaysAfterOpening: daysAfterOpening,
    deliveryShortKg: row.delivery_short_kg,
    lastSync: row.last_sync,
    daysSinceSync: row.last_sync
      ? Math.max(Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${localDate(row.last_sync)}T00:00:00Z`)) / 86400000), 0)
      : null,
  };
}

/**
 * GET /api/analytics/term?subCounty=&termId=
 * The sub-county's schools, term so far. Defaults to the term running today.
 */
async function getTermAnalytics(req, res, next) {
  try {
    const subCounty = subCountyFor(req.user, req.query.subCounty);
    const today = localDate(clock.now());
    const term = await chooseTerm(req.query.termId, today);
    const opensOn = term.opens_on;
    const closesOn = term.closes_on;
    const asOf = today < closesOn ? today : closesOn;

    const result = await pool.query(SCHOOL_FIGURES, [
      subCounty, opensOn, asOf,
      term.half_term_start,
      term.half_term_end,
      term.id,
    ]);
    if (result.rows.length === 0) throw new NotFoundError('Sub-county not found');
    const terms = await pool.query(
      'SELECT id, year, term FROM school_terms WHERE opens_on <= $1 ORDER BY opens_on DESC LIMIT 6', [today]
    );

    res.json({
      subCounty,
      term: { id: term.id, year: term.year, term: term.term, opensOn: toDisplay(opensOn), closesOn: toDisplay(closesOn) },
      asOf: toDisplay(asOf),
      terms: terms.rows.map((t) => ({ id: t.id, label: `Term ${t.term} ${t.year}` })),
      schools: result.rows.map((row) => schoolFigures(row, opensOn, asOf)),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getTermAnalytics };
