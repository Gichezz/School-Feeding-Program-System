const { pool } = require('../db/pool');
const { NotFoundError } = require('../utils/errors');
const { reviewInputs } = require('./reviewInputs');
const { requestScores } = require('./scoringClient');

/**
 * Score one sub-county's week and store the ranking, replacing any earlier ranking of
 * that week. Used by an officer's "Score this week" and by the weekly schedule
 * (services/weeklyReviewSchedule.js). Decisions live apart from rankings, so they are
 * kept whoever scores the week again.
 *
 * The run is stamped with the moment its records were read, so a record that syncs
 * while the week is being scored is still seen as newer than the run and gets the week
 * scored again.
 */
async function scoreWeek({ subCounty, weekStart, k, userId = null, bySchedule = false }, db = pool) {
  const readAt = new Date();
  const inputs = await reviewInputs(db, subCounty, weekStart, k);
  if (inputs.schools.length === 0) throw new NotFoundError('Sub-county not found');
  const result = await requestScores(inputs);
  const known = new Set(inputs.schools.map((s) => s.school_id));
  const items = result.items.filter((i) => known.has(i.school_id));

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const run = await client.query(
      `INSERT INTO review_runs (sub_county, week_start, mode, model, k, rule_breaches, created_by, scored_by_schedule, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (sub_county, week_start) DO UPDATE
         SET mode = EXCLUDED.mode, model = EXCLUDED.model, k = EXCLUDED.k, rule_breaches = EXCLUDED.rule_breaches,
             created_by = EXCLUDED.created_by, scored_by_schedule = EXCLUDED.scored_by_schedule,
             created_at = EXCLUDED.created_at
       RETURNING id`,
      [subCounty, weekStart, result.mode, result.model ? JSON.stringify(result.model) : null, k,
        JSON.stringify(result.rule_breaches || []), userId, bySchedule, readAt]
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
  return { mode: result.mode, listed: items.filter((i) => i.listed).length, notice: result.notice };
}

module.exports = { scoreWeek };
