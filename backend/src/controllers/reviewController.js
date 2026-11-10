const { pool } = require('../db/pool');
const { isUuid } = require('../validation/records');
const { FLAGS, valuesOf } = require('../services/integrity');
const { visibleSchool } = require('../services/schoolAccess');

/**
 * Record review (#62): records flagged as unusual, and the saved versions of any record.
 * Flags never block a record; a programme officer (for the schools in their sub-county)
 * or an administrator checks each one, for example against the school's register or
 * store book, and notes what they found.
 */

// Each kind of record that can be flagged, and the table that holds it
const TABLES = {
  attendance: 'attendance_records',
  meal_distribution: 'meal_distributions',
  daily_feeding: 'daily_feeding',
  enrolment: 'enrolment',
  stock_movement: 'stock_movements',
  stock_count: 'stock_counts',
};
const ENTITY_TYPES = Object.keys(TABLES);
const MAX_NOTE_LENGTH = 500;

const iso = (date) => {
  if (!date) return null;
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
};
const num = (value) => (value === null || value === undefined ? null : Number(value));

/** A flagged record's figures, for the review card. */
function valuesFor(entityType, row) {
  switch (entityType) {
    case 'daily_feeding':
      return {
        date: iso(row.feeding_date), happened: row.feeding_happened, present: row.learners_present,
        fed: row.learners_fed, cerealsKg: num(row.cereals_kg), pulsesKg: num(row.pulses_kg), reason: row.reason_code,
      };
    case 'enrolment':
      return { term: row.term_label, class: row.class, sex: row.sex, learners: row.learners };
    case 'stock_movement':
      return {
        date: iso(row.movement_date), kind: row.kind, commodity: row.commodity, quantityKg: num(row.quantity_kg),
        noteQuantityKg: num(row.note_quantity_kg), reference: row.reference, witness: row.witness || null,
      };
    case 'stock_count':
      return { date: iso(row.count_date), commodity: row.commodity, countedKg: num(row.counted_kg) };
    default:
      return valuesOf(entityType, row);
  }
}

function flagSelect(entityType, officer) {
  const term = entityType === 'enrolment'
    ? `, CASE WHEN t.id IS NOT NULL THEN COALESCE(t.label, 'Term ' || t.term || ' ' || t.year) END AS term_label`
    : '';
  return `
    SELECT f.*, r.*, f.id AS flag_id, f.version AS flag_version, f.created_at AS flagged_at, f.status AS flag_status,
           s.name AS school_name, c.name AS captured_by_name, d.name AS device_name, k.name AS checked_by_name${term}
    FROM record_flags f
    JOIN ${TABLES[entityType]} r ON r.id = f.record_id
    JOIN schools s ON s.id = r.school_id
    LEFT JOIN users c ON c.id = r.captured_by
    LEFT JOIN devices d ON d.id = r.device_id
    LEFT JOIN users k ON k.id = f.checked_by
    ${entityType === 'enrolment' ? 'LEFT JOIN school_terms t ON t.id = r.term_id' : ''}
    WHERE f.entity_type = '${entityType}' AND f.status = $1 ${officer ? 'AND s.sub_county = $2' : ''}`;
}

function publicFlag(entityType, row) {
  return {
    id: row.flag_id,
    entityType,
    recordId: row.record_id,
    version: row.flag_version,
    flag: row.flag,
    title: FLAGS[row.flag],
    detail: row.detail,
    status: row.flag_status,
    note: row.note,
    checkedBy: row.checked_by_name,
    checkedAt: row.checked_at,
    flaggedAt: row.flagged_at,
    school: row.school_name,
    values: valuesFor(entityType, row),
    capturedBy: row.captured_by_name,
    device: row.device_name,
    capturedAt: row.captured_at,
    receivedAt: row.received_at,
    lateReason: row.late_reason,
  };
}

/** The school a record belongs to, if this person may see it. */
async function recordSchoolVisible(user, entityType, recordId) {
  if (!TABLES[entityType] || !isUuid(recordId)) return false;
  const record = (await pool.query(`SELECT school_id FROM ${TABLES[entityType]} WHERE id = $1`, [recordId])).rows[0];
  return Boolean(record && (await visibleSchool(pool, user, record.school_id)));
}

/**
 * GET /api/review/flags?status=open|checked → { flags, openCount }
 * Programme officers see the flags of their sub-county's schools; administrators all.
 */
async function listFlags(req, res, next) {
  try {
    const status = req.query.status === 'checked' ? 'checked' : 'open';
    const officer = req.user.role === 'programme_officer';
    const params = officer ? [status, req.user.subCounty] : [status];
    const flags = [];
    let openCount = 0;
    for (const entityType of ENTITY_TYPES) {
      const result = await pool.query(`${flagSelect(entityType, officer)} ORDER BY f.created_at DESC LIMIT 200`, params);
      flags.push(...result.rows.map((row) => publicFlag(entityType, row)));
      openCount += (await pool.query(
        `SELECT count(*)::int AS n FROM (${flagSelect(entityType, officer)}) open_flags`,
        officer ? ['open', req.user.subCounty] : ['open']
      )).rows[0].n;
    }
    flags.sort((a, b) => new Date(b.flaggedAt) - new Date(a.flaggedAt));
    res.json({ flags, openCount });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/review/flags/:id/check  Body: { note } → { flag }
 */
async function checkFlag(req, res, next) {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Flag not found' });
    const { note } = req.body || {};
    if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > MAX_NOTE_LENGTH)) {
      return res.status(400).json({ error: `The note must be text of at most ${MAX_NOTE_LENGTH} characters` });
    }
    const flag = (await pool.query('SELECT entity_type, record_id FROM record_flags WHERE id = $1', [req.params.id])).rows[0];
    if (!flag || !(await recordSchoolVisible(req.user, flag.entity_type, flag.record_id))) {
      return res.status(404).json({ error: 'Flag not found or already checked' });
    }
    const result = await pool.query(
      `UPDATE record_flags SET status = 'checked', note = $2, checked_by = $3, checked_at = NOW()
       WHERE id = $1 AND status = 'open'
       RETURNING id`,
      [req.params.id, note?.trim() || null, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Flag not found or already checked' });
    res.json({ flag: { id: result.rows[0].id, status: 'checked' } });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/review/records/:entityType/:id/history → { history }
 * Every saved version, oldest first: who changed it, from which device, and when.
 */
async function recordHistory(req, res, next) {
  try {
    const { entityType, id } = req.params;
    if (!(await recordSchoolVisible(req.user, entityType, id))) return res.status(404).json({ error: 'Record not found' });
    const result = await pool.query(
      `SELECT h.version, h.values, h.captured_at, h.changed_at, u.name AS changed_by, d.name AS device
       FROM record_history h
       LEFT JOIN users u ON u.id = h.changed_by
       LEFT JOIN devices d ON d.id = h.device_id
       WHERE h.entity_type = $1 AND h.record_id = $2
       ORDER BY h.changed_at, h.version`,
      [entityType, id]
    );
    res.json({
      history: result.rows.map((row) => ({
        version: row.version,
        values: row.values,
        changedBy: row.changed_by,
        device: row.device,
        capturedAt: row.captured_at,
        changedAt: row.changed_at,
      })),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listFlags,
  checkFlag,
  recordHistory,
};
