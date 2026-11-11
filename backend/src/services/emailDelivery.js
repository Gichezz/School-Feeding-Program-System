const { pool } = require('../db/pool');
const { sendMail, deviceApprovedEmail } = require('./mailer');

/**
 * Email delivery records and account history (migration 021).
 *
 * Every email Lishe tries to send is recorded with its state:
 *   queued    recorded, not yet tried
 *   failed    the attempt did not reach the provider (with the reason)
 *   accepted  the provider took the message. This is not proof that it reached the inbox,
 *             or that anyone read it, and the app never says "delivered".
 *
 * Account events record what happened to an account and who did it, for the
 * administrator's account history.
 */

/** Record one email and try to send it. Returns { id, status }. */
async function deliver({ kind, userId, deviceId = null, to, message }) {
  const id = (await pool.query(
    'INSERT INTO email_deliveries (kind, user_id, device_id) VALUES ($1, $2, $3) RETURNING id',
    [kind, userId, deviceId]
  )).rows[0].id;
  return attempt(id, to, message);
}

async function attempt(id, to, message) {
  const result = await sendMail({ to, ...message });
  const status = result.sent ? 'accepted' : 'failed';
  await pool.query(
    `UPDATE email_deliveries
     SET status = $2, attempts = attempts + 1, last_error = $3, updated_at = NOW(),
         accepted_at = CASE WHEN $2 = 'accepted' THEN NOW() ELSE accepted_at END
     WHERE id = $1`,
    [id, status, result.sent ? null : result.error]
  );
  return { id, status };
}

async function recordAccountEvent(db, { userId, kind, actorId = null, note = null }) {
  await db.query('INSERT INTO account_events (user_id, kind, actor_id, note) VALUES ($1, $2, $3, $4)', [userId, kind, actorId, note]);
}

/**
 * The staff on a newly approved device whose email address is verified, told they can
 * sign in. Their device also finds out by itself, so this is only a notice: it runs after
 * the approval is saved, and a failure is recorded, never undoing the approval.
 */
async function notifyDeviceApproved(device, { onlyFailed = false } = {}) {
  const staff = (await pool.query(
    `SELECT u.id, u.name, u.email FROM device_users du JOIN users u ON u.id = du.user_id
     WHERE du.device_id = $1 AND u.is_active AND u.email_verified_at IS NOT NULL
       ${onlyFailed ? `AND (SELECT status FROM email_deliveries e WHERE e.user_id = u.id AND e.device_id = du.device_id
                            AND e.kind = 'device_approved' ORDER BY e.created_at DESC LIMIT 1) = 'failed'` : ''}`,
    [device.id]
  )).rows;
  const results = [];
  for (const person of staff) {
    results.push(await deliver({
      kind: 'device_approved', userId: person.id, deviceId: device.id, to: person.email,
      message: deviceApprovedEmail({ name: person.name, deviceName: device.name }),
    }));
  }
  return results;
}

/** An account's history, newest first, for the administrator. */
async function accountHistory(userId) {
  const events = (await pool.query(
    `SELECT e.kind, e.note, e.created_at, a.name AS actor
     FROM account_events e LEFT JOIN users a ON a.id = e.actor_id
     WHERE e.user_id = $1 ORDER BY e.created_at DESC, e.id`,
    [userId]
  )).rows;
  const emails = (await pool.query(
    `SELECT kind, status, attempts, last_error, created_at, updated_at, accepted_at
     FROM email_deliveries WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  )).rows;
  return {
    events: events.map((e) => ({ kind: e.kind, note: e.note, at: e.created_at, by: e.actor })),
    emails: emails.map((e) => ({
      kind: e.kind, status: e.status, attempts: e.attempts, error: e.last_error,
      at: e.created_at, updatedAt: e.updated_at, acceptedAt: e.accepted_at,
    })),
  };
}

module.exports = { deliver, recordAccountEvent, notifyDeviceApproved, accountHistory };
