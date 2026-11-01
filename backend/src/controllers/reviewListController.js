const { pool } = require('../db/pool');
const clock = require('../utils/clock');
const { ValidationError, NotFoundError } = require('../utils/errors');
const { isUuid, isDisplayDate } = require('../validation/records');
const { localDate } = require('../validation/entryWindow');
const { reviewInputs } = require('../services/reviewInputs');
const { requestScores } = require('../services/scoringClient');
const { subCountyFor } = require('../services/schoolAccess');

/**
 * Weekly review lists for programme officers: each week the schools of a sub-county are
 * ranked by how unusual their records look, and the top few are listed for the officer
 * to look into. The ranking only says which records to check first; the officer decides,
 * marking each listed school's week explained (with what explained it) or follow-up.
 */

const DEFAULT_K = 3;
const MAX_K = 20;
const MAX_NOTE_LENGTH = 500;
const STATUSES = ['explained', 'follow_up'];

const toIso = (display) => display.split('-').reverse().join('-');
const toDisplay = (isoDate) => (isoDate ? isoDate.split('-').reverse().join('-') : null);

/** The week's Monday from a DD-MM-YYYY path parameter, refusing other days and future weeks. */
function parseWeek(value) {
  if (!isDisplayDate(value)) throw new ValidationError('week must be a date in DD-MM-YYYY format');
  const weekStart = toIso(value);
  if (new Date(`${weekStart}T00:00:00Z`).getUTCDay() !== 1) throw new ValidationError('week must be a Monday');
  if (weekStart > localDate(clock.now())) throw new ValidationError('That week has not started yet');
  return weekStart;
}

function parseK(value) {
  if (value === undefined) return DEFAULT_K;
  if (!Number.isInteger(value) || value < 1 || value > MAX_K) {
    throw new ValidationError(`k must be a whole number from 1 to ${MAX_K}`);
  }
  return value;
}

async function loadRun(db, subCounty, weekStart) {
  const run = (await db.query(
    `SELECT r.*, u.name AS created_by_name FROM review_runs r LEFT JOIN users u ON u.id = r.created_by
     WHERE r.sub_county = $1 AND r.week_start = $2`,
    [subCounty, weekStart]
  )).rows[0];
  if (!run) return null;

  const items = await db.query(
    `SELECT i.school_id, s.name AS school_name, i.rank, i.listed, i.score, to_char(i.top_date, 'YYYY-MM-DD') AS top_date,
            i.reasons, i.explanation, d.status, d.note, d.reviewed_at, u.name AS reviewed_by_name
     FROM review_items i
     JOIN schools s ON s.id = i.school_id
     LEFT JOIN review_decisions d ON d.school_id = i.school_id AND d.week_start = $2
     LEFT JOIN users u ON u.id = d.reviewed_by
     WHERE i.run_id = $1
     ORDER BY i.rank`,
    [run.id, weekStart]
  );
  const names = Object.fromEntries(items.rows.map((i) => [i.school_id, i.school_name]));

  return {
    subCounty,
    week: toDisplay(weekStart),
    mode: run.mode,
    model: run.model,
    k: run.k,
    scoredAt: run.created_at,
    scoredBy: run.created_by_name,
    items: items.rows.map((i) => ({
      schoolId: i.school_id,
      schoolName: i.school_name,
      rank: i.rank,
      listed: i.listed,
      score: i.score,
      topDate: toDisplay(i.top_date),
      reasons: i.reasons,
      explanation: i.explanation,
      decision: i.status
        ? { status: i.status, note: i.note, reviewedBy: i.reviewed_by_name, reviewedAt: i.reviewed_at }
        : null,
    })),
    ruleBreaches: run.rule_breaches.map((b) => ({
      schoolId: b.school_id,
      schoolName: names[b.school_id] || null,
      date: toDisplay(b.date),
      rule: b.rule,
      detail: b.detail,
    })),
  };
}

/**
 * GET /api/review-lists?subCounty=
 * The sub-county's scored weeks, newest first, with how many listed schools are decided.
 */
async function listRuns(req, res, next) {
  try {
    const subCounty = subCountyFor(req.user, req.query.subCounty);
    const result = await pool.query(
      `SELECT to_char(r.week_start, 'YYYY-MM-DD') AS week_start, r.mode, r.k, r.created_at,
              COUNT(i.id) FILTER (WHERE i.listed)::int AS listed,
              COUNT(d.id) FILTER (WHERE i.listed)::int AS decided
       FROM review_runs r
       LEFT JOIN review_items i ON i.run_id = r.id
       LEFT JOIN review_decisions d ON d.school_id = i.school_id AND d.week_start = r.week_start
       WHERE r.sub_county = $1
       GROUP BY r.id
       ORDER BY r.week_start DESC
       LIMIT 52`,
      [subCounty]
    );
    res.json({
      subCounty,
      weeks: result.rows.map((r) => ({
        week: toDisplay(r.week_start), mode: r.mode, k: r.k, scoredAt: r.created_at, listed: r.listed, decided: r.decided,
      })),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/review-lists/:week?subCounty=
 * One week's ranking, with each school's reasons and the officer's decision.
 */
async function getRun(req, res, next) {
  try {
    const weekStart = parseWeek(req.params.week);
    const subCounty = subCountyFor(req.user, req.query.subCounty);
    const run = await loadRun(pool, subCounty, weekStart);
    if (!run) throw new NotFoundError('That week has not been scored yet');
    res.json(run);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/review-lists/:week/run  { subCounty?, k? }
 * Score the week (again). Records that synced since the last run are included; the
 * officer's decisions are kept.
 */
async function runWeek(req, res, next) {
  try {
    const weekStart = parseWeek(req.params.week);
    const subCounty = subCountyFor(req.user, req.body.subCounty);
    const k = parseK(req.body.k);

    const inputs = await reviewInputs(pool, subCounty, weekStart, k);
    if (inputs.schools.length === 0) throw new NotFoundError('Sub-county not found');
    const result = await requestScores(inputs);
    const known = new Set(inputs.schools.map((s) => s.school_id));
    const items = result.items.filter((i) => known.has(i.school_id));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const run = await client.query(
        `INSERT INTO review_runs (sub_county, week_start, mode, model, k, rule_breaches, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (sub_county, week_start) DO UPDATE
           SET mode = EXCLUDED.mode, model = EXCLUDED.model, k = EXCLUDED.k, rule_breaches = EXCLUDED.rule_breaches,
               created_by = EXCLUDED.created_by, created_at = NOW()
         RETURNING id`,
        [subCounty, weekStart, result.mode, result.model ? JSON.stringify(result.model) : null, k,
          JSON.stringify(result.rule_breaches || []), req.user.id]
      );
      const runId = run.rows[0].id;
      await client.query('DELETE FROM review_items WHERE run_id = $1', [runId]);
      if (items.length > 0) {
        await client.query(
          `INSERT INTO review_items (run_id, school_id, rank, listed, score, top_date, reasons, explanation)
           SELECT $1, t.school_id, t.rank, t.listed, t.score, t.top_date, t.reasons, t.explanation
           FROM jsonb_to_recordset($2::jsonb)
             AS t(school_id uuid, rank int, listed boolean, score float8, top_date date, reasons jsonb, explanation text)`,
          [runId, JSON.stringify(items)]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    res.status(201).json({ ...(await loadRun(pool, subCounty, weekStart)), notice: result.notice });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/review-lists/:week/decisions/:schoolId  { status, note }
 * The officer's decision on a school's week. A note is required either way: what
 * explained the records, or what the follow-up is.
 */
async function decide(req, res, next) {
  try {
    const weekStart = parseWeek(req.params.week);
    const { schoolId } = req.params;
    if (!isUuid(schoolId)) throw new ValidationError('Invalid school ID format');
    const { status, note } = req.body;
    if (!STATUSES.includes(status)) throw new ValidationError('status must be explained or follow_up');
    if (typeof note !== 'string' || !note.trim()) throw new ValidationError('A note is required');
    if (note.length > MAX_NOTE_LENGTH) throw new ValidationError(`note must be at most ${MAX_NOTE_LENGTH} characters`);

    const school = (await pool.query('SELECT id, sub_county FROM schools WHERE id = $1', [schoolId])).rows[0];
    if (!school || (req.user.role === 'programme_officer' && school.sub_county !== req.user.subCounty)) {
      throw new NotFoundError('School not found');
    }
    const ranked = await pool.query(
      `SELECT 1 FROM review_items i JOIN review_runs r ON r.id = i.run_id
       WHERE r.sub_county = $1 AND r.week_start = $2 AND i.school_id = $3`,
      [school.sub_county, weekStart, schoolId]
    );
    if (ranked.rows.length === 0) throw new ValidationError('That school has not been ranked for that week');

    const saved = await pool.query(
      `INSERT INTO review_decisions (school_id, week_start, status, note, reviewed_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (school_id, week_start) DO UPDATE
         SET status = EXCLUDED.status, note = EXCLUDED.note, reviewed_by = EXCLUDED.reviewed_by, reviewed_at = NOW()
       RETURNING status, note, reviewed_at`,
      [schoolId, weekStart, status, note.trim(), req.user.id]
    );
    const row = saved.rows[0];
    res.json({
      schoolId, week: toDisplay(weekStart), status: row.status, note: row.note,
      reviewedBy: req.user.name, reviewedAt: row.reviewed_at,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { listRuns, getRun, runWeek, decide };
