const { pool } = require('../db/pool');
const clock = require('../utils/clock');
const { localDate } = require('../validation/entryWindow');
const { scoreWeek } = require('./reviewRuns');

/**
 * The weekly review list, scored without anyone pressing a button. Every hour the API
 * looks at each sub-county's last few finished weeks and scores a week that:
 *   - has feeding records but has never been scored, or
 *   - has had a feeding record or store count saved or changed since it was last scored
 *     (records that synced late, or a conflict decided since).
 * So on Monday morning each officer finds last week's list ready, and a school that
 * syncs a week late is still ranked with its records.
 *
 * Only finished weeks (Monday to Sunday, in the schools' time zone) are scored here; an
 * officer can still score the week in progress from the page. A week that fails (the
 * scoring service is down, for example) is tried again on the next pass.
 */

const LOOK_BACK_WEEKS = 4;
const DEFAULT_K = 3;
const DEFAULT_INTERVAL_MINUTES = 60;
const FIRST_PASS_DELAY_MS = 30 * 1000;
// One pass at a time, even with more than one API process on the same database
const LOCK_KEY = 72017;

const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** The Mondays of the `count` weeks that ended before today, newest first. */
function finishedWeeks(now = clock.now(), count = LOOK_BACK_WEEKS) {
  const today = localDate(now);
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;   // Monday 0
  const thisMonday = addDays(today, -weekday);
  return Array.from({ length: count }, (_, i) => addDays(thisMonday, -7 * (i + 1)));
}

/** The sub-county weeks to score now, oldest first, with the k to keep. */
async function dueWeeks(db, weeks) {
  const result = await db.query(
    `SELECT sc.sub_county, to_char(w.week_start, 'YYYY-MM-DD') AS week_start, r.created_at AS scored_at, r.k,
            f.records, f.last_change AS feeding_change, c.last_change AS count_change
     FROM (SELECT DISTINCT sub_county FROM schools WHERE sub_county IS NOT NULL) sc
     CROSS JOIN unnest($1::date[]) AS w(week_start)
     LEFT JOIN review_runs r ON r.sub_county = sc.sub_county AND r.week_start = w.week_start
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS records, MAX(GREATEST(df.updated_at, df.received_at)) AS last_change
       FROM daily_feeding df JOIN schools s ON s.id = df.school_id
       WHERE s.sub_county = sc.sub_county AND df.feeding_date BETWEEN w.week_start AND w.week_start + 6
     ) f ON true
     LEFT JOIN LATERAL (
       SELECT MAX(sk.received_at) AS last_change
       FROM stock_counts sk JOIN schools s ON s.id = sk.school_id
       WHERE s.sub_county = sc.sub_county AND sk.count_date BETWEEN w.week_start AND w.week_start + 6
     ) c ON true
     ORDER BY w.week_start, sc.sub_county`,
    [weeks]
  );
  return result.rows
    .filter((r) => r.records > 0)
    .filter((r) => {
      if (!r.scored_at) return true;
      const changed = [r.feeding_change, r.count_change].filter(Boolean).map((t) => new Date(t).getTime());
      return changed.some((t) => t > new Date(r.scored_at).getTime());
    })
    .map((r) => ({ subCounty: r.sub_county, weekStart: r.week_start, k: r.k || DEFAULT_K, rescore: Boolean(r.scored_at) }));
}

/**
 * One pass: score every due week. Returns what was scored and what failed; never throws
 * for a single week, so one sub-county's problem does not hold up the others.
 */
async function runSchedulePass({ db = pool, now = clock.now(), log = console } = {}) {
  const lock = await db.connect();
  try {
    const got = (await lock.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY])).rows[0].ok;
    if (!got) return { skipped: true, scored: [], failed: [] };
    try {
      const scored = [];
      const failed = [];
      for (const week of await dueWeeks(db, finishedWeeks(now))) {
        try {
          const result = await scoreWeek({ subCounty: week.subCounty, weekStart: week.weekStart, k: week.k, bySchedule: true }, db);
          scored.push({ ...week, mode: result.mode, listed: result.listed });
        } catch (error) {
          failed.push({ ...week, error: error.message });
        }
      }
      if (scored.length) {
        log.info(`Weekly review: scored ${scored.map((w) => `${w.subCounty} ${w.weekStart}${w.rescore ? ' (again)' : ''}`).join(', ')}`);
      }
      if (failed.length) {
        log.warn(`Weekly review: could not score ${failed.length} week(s), trying again next pass: ${failed[0].error}`);
      }
      return { skipped: false, scored, failed };
    } finally {
      await lock.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    lock.release();
  }
}

/**
 * Start the schedule: a first pass shortly after start-up, then one every
 * REVIEW_SCHEDULE_MINUTES (default 60). REVIEW_SCHEDULE=off turns it off.
 */
function startWeeklyReviewSchedule({ log = console } = {}) {
  if (String(process.env.REVIEW_SCHEDULE || '').toLowerCase() === 'off') {
    log.info('Weekly review schedule is off (REVIEW_SCHEDULE=off)');
    return null;
  }
  const minutes = Number(process.env.REVIEW_SCHEDULE_MINUTES) || DEFAULT_INTERVAL_MINUTES;
  const pass = () => runSchedulePass({ log }).catch((error) => log.warn(`Weekly review: pass failed: ${error.message}`));
  const first = setTimeout(pass, FIRST_PASS_DELAY_MS);
  const every = setInterval(pass, minutes * 60 * 1000);
  first.unref();
  every.unref();
  log.info(`Weekly review schedule: scoring finished weeks every ${minutes} minutes`);
  return { stop: () => { clearTimeout(first); clearInterval(every); } };
}

module.exports = { finishedWeeks, dueWeeks, runSchedulePass, startWeeklyReviewSchedule, LOOK_BACK_WEEKS };
