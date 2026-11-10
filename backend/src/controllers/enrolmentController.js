const { pool } = require('../db/pool');
const clock = require('../utils/clock');
const { ValidationError, NotFoundError } = require('../utils/errors');
const { isUuid } = require('../validation/records');
const { localDate } = require('../validation/entryWindow');
const { subCountyFor, visibleSchool } = require('../services/schoolAccess');
const { chooseTerm, termLabel } = require('./analyticsController');

/**
 * Enrolment verification. A school's termly enrolment sets the food it can request, so a
 * programme officer checks it against the admission register (or the national learner
 * records) and verifies it. Until then the school's term plan says the request may
 * change. Changing a verified number on the device clears its verification
 * (sync/recordTypes.js), so a number only counts as verified as it was checked.
 *
 * System administrators can read every sub-county's enrolment but verify nothing.
 */

/**
 * GET /api/enrolment?subCounty=&termId=
 * Each school in the sub-county with its enrolment for the term, by class and sex, and
 * whether it is verified.
 */
async function listEnrolment(req, res, next) {
  try {
    const subCounty = subCountyFor(req.user, req.query.subCounty);
    const today = localDate(clock.now());
    const term = await chooseTerm(req.query.termId, today);
    const terms = await pool.query(
      'SELECT id, year, term, label FROM school_terms WHERE opens_on <= $1 ORDER BY opens_on DESC LIMIT 6', [today]
    );
    const rows = (await pool.query(
      `SELECT s.id AS school_id, s.name AS school_name, e.class, e.sex, e.learners, e.verified_at, u.name AS verified_by
       FROM schools s
       LEFT JOIN enrolment e ON e.school_id = s.id AND e.term_id = $2
       LEFT JOIN users u ON u.id = e.verified_by
       WHERE s.sub_county = $1
       ORDER BY s.name, e.class, e.sex`,
      [subCounty, term.id]
    )).rows;

    const schools = new Map();
    for (const r of rows) {
      if (!schools.has(r.school_id)) {
        schools.set(r.school_id, { schoolId: r.school_id, schoolName: r.school_name, learners: 0, classes: [] });
      }
      if (r.class === null) continue;
      const school = schools.get(r.school_id);
      school.learners += r.learners;
      school.classes.push({ class: r.class, sex: r.sex, learners: r.learners, verified: r.verified_at !== null });
    }
    const latest = new Map();
    for (const r of rows) {
      if (r.verified_at && (!latest.has(r.school_id) || r.verified_at > latest.get(r.school_id).at)) {
        latest.set(r.school_id, { at: r.verified_at, by: r.verified_by });
      }
    }

    res.json({
      subCounty,
      term: { id: term.id, label: termLabel(term) },
      terms: terms.rows.map((t) => ({ id: t.id, label: termLabel(t) })),
      schools: [...schools.values()].map((s) => {
        const verified = s.classes.filter((c) => c.verified).length;
        const status = s.classes.length === 0 ? 'not_entered'
          : verified === s.classes.length ? 'verified' : verified > 0 ? 'changed' : 'not_verified';
        return {
          ...s,
          status,
          verifiedAt: latest.get(s.schoolId)?.at || null,
          verifiedBy: latest.get(s.schoolId)?.by || null,
        };
      }),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/enrolment/:schoolId/:termId/verify
 * The officer has checked the school's enrolment for the term: every class not yet
 * verified is marked verified by them. Each becomes a new version, kept in the record's
 * history, so the school's devices download it with their next sync.
 */
async function verifyEnrolment(req, res, next) {
  const client = await pool.connect();
  try {
    const { schoolId, termId } = req.params;
    if (!isUuid(schoolId) || !isUuid(termId)) throw new ValidationError('Invalid school or term ID format');
    const school = await visibleSchool(client, req.user, schoolId);
    if (!school) throw new NotFoundError('School not found');
    const term = (await client.query('SELECT id FROM school_terms WHERE id = $1', [termId])).rows[0];
    if (!term) throw new NotFoundError('Term not found');

    await client.query('BEGIN');
    const updated = (await client.query(
      `UPDATE enrolment
       SET verified_by = $3, verified_at = NOW(), version = version + 1, updated_at = NOW()
       WHERE school_id = $1 AND term_id = $2 AND verified_at IS NULL
       RETURNING id, version, class, sex, learners, term_id`,
      [schoolId, termId, req.user.id]
    )).rows;
    const entered = (await client.query(
      'SELECT count(*)::int AS n FROM enrolment WHERE school_id = $1 AND term_id = $2', [schoolId, termId]
    )).rows[0].n;
    if (entered === 0) {
      await client.query('ROLLBACK');
      throw new ValidationError('This school has not entered its enrolment for this term');
    }
    for (const row of updated) {
      await client.query(
        `INSERT INTO record_history (entity_type, record_id, version, values, changed_by)
         VALUES ('enrolment', $1, $2, $3, $4)`,
        [row.id, row.version, JSON.stringify({ term: row.term_id, class: row.class, sex: row.sex, learners: row.learners, verified: true }), req.user.id]
      );
    }
    await client.query('COMMIT');
    res.json({ schoolId, termId, verified: updated.length, verifiedBy: req.user.name });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

module.exports = { listEnrolment, verifyEnrolment };
