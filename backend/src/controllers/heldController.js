const { pool } = require('../db/pool');
const { isUuid } = require('../validation/records');
const { HOLD_REASONS } = require('../services/captureCheck');
const { handleCreateOperation, handleUpdateOperation } = require('./syncController');
const { afterRecordSaved } = require('../services/integrity');
const { checkEntryWindow } = require('../validation/entryWindow');

/**
 * Held records (#61): records captured on a school device that the server did not
 * apply automatically, because the person who captured them was deactivated or had
 * their password reset afterwards, or because the device was removed. Administrators
 * review each one and apply or discard it, so nothing captured offline is lost silently.
 */

const ENTITY_FOR_SYNC = { attendance: 'attendance', meal_distribution: 'mealDistribution' };

function publicHeld(row) {
  return {
    id: row.id,
    entityType: ENTITY_FOR_SYNC[row.entity_type],
    operation: row.operation_type,
    payload: row.payload,
    reason: row.reason,
    reasonText: HOLD_REASONS[row.reason],
    status: row.status,
    capturedAt: row.captured_at,
    capturedBy: row.captured_by_name || null,
    device: row.device_name || null,
    submittedBy: row.submitted_by_name || null,
    createdAt: row.created_at,
  };
}

/**
 * GET /api/sync/held → { held } (administrators)
 * Records waiting for a decision, oldest first.
 */
async function listHeld(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT h.*, c.name AS captured_by_name, s.name AS submitted_by_name, d.name AS device_name
       FROM held_operations h
       LEFT JOIN users c ON c.id = h.captured_by
       LEFT JOIN users s ON s.id = h.submitted_by
       LEFT JOIN devices d ON d.id = h.device_id
       WHERE h.status = 'pending'
       ORDER BY h.captured_at NULLS LAST, h.created_at`
    );
    res.json({ held: result.rows.map(publicHeld) });
  } catch (error) {
    next(error);
  }
}

async function findPending(client, id) {
  if (!isUuid(id)) return null;
  return (await client.query("SELECT * FROM held_operations WHERE id = $1 AND status = 'pending' FOR UPDATE", [id])).rows[0] || null;
}

/**
 * POST /api/sync/held/:id/apply (administrators)
 * Apply the record as captured. The record keeps its original author; the review is
 * recorded with the administrator. If the server's copy changed since, nothing is
 * applied (409) and the administrator can discard it instead.
 */
async function applyHeld(req, res, next) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const held = await findPending(client, req.params.id);
    if (!held) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Held record not found' });
    }

    const operation = {
      id: held.operation_id,
      entityType: ENTITY_FOR_SYNC[held.entity_type],
      operation: held.operation_type,
      payload: held.payload,
      baseVersion: held.base_version,
    };
    const author = held.captured_by || req.user.id;
    let result;
    try {
      result = operation.operation === 'create'
        ? await handleCreateOperation(client, operation, held.client_id, author)
        : await handleUpdateOperation(client, operation, held.client_id, author);
    } catch {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'The server copy of this record has changed since it was captured, so it was not applied. Discard it, or ask the school to check and record it again.',
      });
    }

    await client.query(
      `INSERT INTO sync_operations
       (operation_id, entity_type, record_id, operation_type, payload, client_id, base_version, status, processed_at,
        captured_by, device_id, captured_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'applied', NOW(), $8, $9, $10)
       ON CONFLICT (operation_id) DO NOTHING`,
      [held.operation_id, held.entity_type, result.recordId, held.operation_type.toUpperCase(), JSON.stringify(held.payload),
        held.client_id, held.base_version, held.captured_by, held.device_id, held.captured_at]
    );
    // Kept as captured, with its review flags, like any synced record (#62)
    const recordDate = held.payload.attendanceDate || held.payload.distributionDate;
    await afterRecordSaved(client, {
      entityType: held.entity_type,
      recordId: result.recordId,
      capture: { capturedBy: held.captured_by, deviceId: held.device_id, capturedAt: held.captured_at },
      lateReason: held.payload.lateReason,
      late: checkEntryWindow(recordDate, { capturedAt: held.captured_at || undefined, lateReason: held.payload.lateReason || 'held' }).late,
    });
    await client.query(
      "UPDATE held_operations SET status = 'applied', reviewed_by = $2, reviewed_at = NOW() WHERE id = $1",
      [held.id, req.user.id]
    );
    await client.query('COMMIT');
    res.json({ recordId: result.recordId, version: result.version });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

/**
 * POST /api/sync/held/:id/discard (administrators)
 */
async function discardHeld(req, res, next) {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Held record not found' });
    const result = await pool.query(
      `UPDATE held_operations SET status = 'discarded', reviewed_by = $2, reviewed_at = NOW()
       WHERE id = $1 AND status = 'pending' RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Held record not found' });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listHeld,
  applyHeld,
  discardHeld,
};
