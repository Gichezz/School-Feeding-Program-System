const { pool } = require('../db/pool');
const { isUuid } = require('../validation/records');
const { FLAGS, valuesOf } = require('../services/integrity');

/**
 * Record review (#62), for administrators: records flagged as unusual, and the saved
 * versions of any record. Flags never block a record; an administrator checks each one
 * (for example against the school's paper register) and notes what they found.
 */

const ENTITY_TYPES = ['attendance', 'meal_distribution'];
const MAX_NOTE_LENGTH = 500;

function flagSelect(entityType) {
  const table = entityType === 'attendance' ? 'attendance_records' : 'meal_distributions';
  return `
    SELECT f.*, r.*, f.id AS flag_id, f.version AS flag_version, f.created_at AS flagged_at, f.status AS flag_status,
           s.name AS school_name, c.name AS captured_by_name, d.name AS device_name, k.name AS checked_by_name
    FROM record_flags f
    JOIN ${table} r ON r.id = f.record_id
    JOIN schools s ON s.id = r.school_id
    LEFT JOIN users c ON c.id = r.captured_by
    LEFT JOIN devices d ON d.id = r.device_id
    LEFT JOIN users k ON k.id = f.checked_by
    WHERE f.entity_type = '${entityType}' AND f.status = $1`;
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
    values: valuesOf(entityType, row),
    capturedBy: row.captured_by_name,
    device: row.device_name,
    capturedAt: row.captured_at,
    receivedAt: row.received_at,
    lateReason: row.late_reason,
  };
}

/**
 * GET /api/review/flags?status=open|checked → { flags, openCount }
 */
async function listFlags(req, res, next) {
  try {
    const status = req.query.status === 'checked' ? 'checked' : 'open';
    const flags = [];
    for (const entityType of ENTITY_TYPES) {
      const result = await pool.query(`${flagSelect(entityType)} ORDER BY f.created_at DESC LIMIT 200`, [status]);
      flags.push(...result.rows.map((row) => publicFlag(entityType, row)));
    }
    flags.sort((a, b) => new Date(b.flaggedAt) - new Date(a.flaggedAt));
    const open = await pool.query("SELECT count(*)::int AS n FROM record_flags WHERE status = 'open'");
    res.json({ flags, openCount: open.rows[0].n });
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
    if (!ENTITY_TYPES.includes(entityType) || !isUuid(id)) return res.status(404).json({ error: 'Record not found' });
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
