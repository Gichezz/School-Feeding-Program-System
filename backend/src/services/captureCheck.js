const { isUuid } = require('../validation/records');

/**
 * Who captured a queued record, and whether the server should apply it now (#61).
 *
 * School devices can be used offline, and several staff can share one device. Each
 * queued record therefore says who captured it, on which device and when. A record is
 * only ever applied under the session of the person who captured it:
 *
 *   apply  the signed-in user captured it, and nothing has changed since
 *   defer  a colleague on the same device captured it; it waits on the device until
 *          that colleague syncs it themselves
 *   hold   the person who captured it was deactivated, or an administrator reset their
 *          password after they captured it, or the device it came from was removed. It is kept on
 *          the server for an administrator to apply or discard, so nothing is lost.
 */

const HOLD_REASONS = {
  user_deactivated: 'The person who captured it has been deactivated',
  password_reset: 'The password of the person who captured it was reset after they captured it',
  device_revoked: 'It was captured on a device that has since been removed',
};

/**
 * Capture details sent with an operation, or an error message.
 * Older clients send none; their records count as captured by the signed-in user.
 */
function captureError(op) {
  if (op.capturedBy !== undefined && op.capturedBy !== null && !isUuid(op.capturedBy)) return 'capturedBy must be a user ID';
  if (op.deviceId !== undefined && op.deviceId !== null && !isUuid(op.deviceId)) return 'deviceId must be a device ID';
  if (op.capturedAt !== undefined && op.capturedAt !== null && Number.isNaN(Date.parse(op.capturedAt))) return 'capturedAt must be a date and time';
  return null;
}

function captureOf(op, user) {
  return {
    capturedBy: op.capturedBy || user.id,
    deviceId: op.deviceId || user.deviceId || null,
    capturedAt: op.capturedAt ? new Date(op.capturedAt) : null,
  };
}

/**
 * { action: 'apply' | 'defer' | 'hold', reason? } for one operation.
 */
async function decideCapture(client, op, user) {
  const capture = captureOf(op, user);

  if (capture.deviceId) {
    const device = (await client.query('SELECT status FROM devices WHERE id = $1', [capture.deviceId])).rows[0];
    if (device?.status === 'revoked') return { action: 'hold', reason: 'device_revoked', capture };
  }

  const capturer = (await client.query(
    'SELECT is_active, password_reset_at FROM users WHERE id = $1',
    [capture.capturedBy]
  )).rows[0];
  if (!capturer || !capturer.is_active) return { action: 'hold', reason: 'user_deactivated', capture };
  if (capturer.password_reset_at && capture.capturedAt && capturer.password_reset_at > capture.capturedAt) {
    return { action: 'hold', reason: 'password_reset', capture };
  }

  if (capture.capturedBy !== user.id) return { action: 'defer', capture };
  return { action: 'apply', capture };
}

module.exports = {
  HOLD_REASONS,
  captureError,
  captureOf,
  decideCapture,
};
