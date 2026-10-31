const { schoolTimezone } = require('../validation/entryWindow');

/**
 * The records the scoring service needs to rank one sub-county's week, gathered from
 * PostgreSQL in the shape forecasting/services/scoring_service.py reads. Only records up
 * to the end of the week are sent, so re-running a past week ranks it as it was then
 * (apart from records that synced later).
 */

// History needed before the week: the model window (125 school days) plus the 20 days
// between refit points, and a term before that for the term-on-term features
const HISTORY_DAYS = 365;

const iso = (column) => `to_char(${column}, 'YYYY-MM-DD')`;

async function reviewInputs(db, subCounty, weekStart, k) {
  const zone = schoolTimezone().replace(/'/g, '');
  const until = '($2::date + 6)';
  const since = `($2::date - ${HISTORY_DAYS})`;
  // Terms and holidays reach back a little further, so the first records' term is known
  const calendarSince = `($1::date - ${HISTORY_DAYS + 120})`;
  const calendarUntil = '($1::date + 6)';

  const terms = await db.query(
    `SELECT id, year, term, ${iso('opens_on')} AS opens_on, ${iso('closes_on')} AS closes_on,
            ${iso('half_term_start')} AS half_term_start, ${iso('half_term_end')} AS half_term_end
     FROM school_terms
     WHERE closes_on >= ${calendarSince} AND opens_on <= ${calendarUntil}
     ORDER BY opens_on`,
    [weekStart]
  );

  // Only national holidays: a closure at one school does not close the others, and the
  // school's own record of that day says why it did not feed
  const closed = await db.query(
    `SELECT ${iso('starts_on')} AS starts_on, ${iso('ends_on')} AS ends_on
     FROM calendar_events
     WHERE kind = 'public_holiday' AND ends_on >= ${calendarSince} AND starts_on <= ${calendarUntil}
     ORDER BY starts_on`,
    [weekStart]
  );

  const schools = await db.query(
    `SELECT id AS school_id, sub_county FROM schools WHERE sub_county = $1 ORDER BY name`,
    [subCounty]
  );

  const enrolment = await db.query(
    `SELECT e.school_id, e.term_id, SUM(e.learners)::int AS learners
     FROM enrolment e JOIN schools s ON s.id = e.school_id
     WHERE s.sub_county = $1
     GROUP BY e.school_id, e.term_id`,
    [subCounty]
  );

  // A record synced without a batch counts as a batch of its own
  const feeding = await db.query(
    `SELECT f.school_id, ${iso('f.feeding_date')} AS date, f.feeding_happened, f.learners_present,
            f.learners_fed, f.cereals_kg::float AS cereals_kg, f.pulses_kg::float AS pulses_kg, f.reason_code,
            to_char(COALESCE(f.captured_at, f.received_at, f.created_at) AT TIME ZONE '${zone}',
                    'YYYY-MM-DD"T"HH24:MI:SS') AS captured_at,
            ${iso(`(COALESCE(f.received_at, f.created_at) AT TIME ZONE '${zone}')::date`)} AS received_date,
            COALESCE(f.sync_batch_id::text, f.id::text) AS sync_batch_id, f.version
     FROM daily_feeding f JOIN schools s ON s.id = f.school_id
     WHERE s.sub_county = $1 AND f.feeding_date BETWEEN ${since} AND ${until}
     ORDER BY f.school_id, f.feeding_date`,
    [subCounty, weekStart]
  );

  // Each count with what the ledger said on that day
  const stockCounts = await db.query(
    `SELECT c.school_id, ${iso('c.count_date')} AS date, c.commodity, c.counted_kg::float AS counted_kg,
            COALESCE((SELECT SUM(fl.quantity_kg) FROM stock_flows fl
                      WHERE fl.school_id = c.school_id AND fl.commodity = c.commodity
                        AND fl.flow_date <= c.count_date), 0)::float AS ledger_kg
     FROM stock_counts c JOIN schools s ON s.id = c.school_id
     WHERE s.sub_county = $1 AND c.commodity IN ('cereals', 'pulses')
       AND c.count_date BETWEEN ${since} AND ${until}
     ORDER BY c.school_id, c.commodity, c.count_date`,
    [subCounty, weekStart]
  );

  // Weeks an officer marked follow-up are left out of the model's fit
  const followUp = await db.query(
    `SELECT d.school_id, to_char(d.week_start, 'IYYY-IW') AS week
     FROM review_decisions d JOIN schools s ON s.id = d.school_id
     WHERE s.sub_county = $1 AND d.status = 'follow_up' AND d.week_start < $2::date`,
    [subCounty, weekStart]
  );

  return {
    week_start: weekStart,
    k,
    terms: terms.rows,
    closed: closed.rows,
    schools: schools.rows,
    enrolment: enrolment.rows,
    feeding: feeding.rows,
    stock_counts: stockCounts.rows,
    follow_up: followUp.rows,
  };
}

module.exports = { reviewInputs };
