const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const { isUuid } = require('../validation/records');
const { passwordError, pinError } = require('../validation/users');
const { hashPassword, sessionFor } = require('../services/userAccounts');
const { saveChallenge, consumeChallenge } = require('../services/challenges');
const devices = require('../services/devices');

/**
 * School devices and staff PIN sign-in (#60).
 *
 * Staff record on designated school devices. A device is enrolled once (its public key
 * is registered, and an administrator approves it); each staff member then sets a PIN
 * on it. Sign-in needs all of: the staff member's email, their PIN for this device, and
 * a fresh challenge signed by the device's private key. So it is multi-factor (the
 * enrolled device + the PIN) and checked by the server.
 */

const MAX_PIN_ATTEMPTS = 5;
const MAX_DEVICE_NAME = 60;
const SETUP_FAILED = 'Those details could not be used to set up this device';
const SIGN_IN_FAILED = 'Email or PIN is not correct';

function devicePublic(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    schoolId: row.school_id,
    ...(row.school_name !== undefined && { schoolName: row.school_name }),
  };
}

/**
 * POST /api/devices/challenge → { challenge } (public)
 * The device signs this to prove it holds its private key.
 */
async function challenge(req, res, next) {
  try {
    const value = devices.newChallenge();
    await saveChallenge(value, 'device');
    res.json({ challenge: value });
  } catch (error) {
    next(error);
  }
}

async function findStaff(email) {
  if (typeof email !== 'string' || !email.trim()) return null;
  const result = await pool.query(
    `SELECT id, name, email, role, school_id, is_active, password_hash
     FROM users WHERE lower(email) = lower($1)`,
    [email.trim()]
  );
  const user = result.rows[0];
  return user && user.role === 'school_staff' && user.is_active ? user : null;
}

/**
 * POST /api/devices/enrol (public)
 * Body: {
 *   email, pin, challenge, signature,
 *   activationCode + newPassword   (new staff member)   or   password (existing account),
 *   deviceId                        (this device is already enrolled)   or
 *   publicKey + deviceName          (enrol this device; it waits for approval)
 * }
 * → 201 { device, user }
 */
async function enrol(req, res, next) {
  const client = await pool.connect();
  try {
    const { email, pin, challenge: signedChallenge, signature, activationCode, newPassword, password, deviceId, publicKey, deviceName } = req.body || {};

    if (!(await consumeChallenge(signedChallenge, 'device'))) {
      return res.status(400).json({ error: 'This set-up request has expired. Start again.' });
    }
    const badPin = pinError(pin);
    if (badPin) return res.status(400).json({ error: badPin });
    if (activationCode) {
      const badPassword = passwordError(newPassword);
      if (badPassword) return res.status(400).json({ error: badPassword });
    } else if (typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Enter your activation code, or your password if you already have an account' });
    }

    // The device: one already enrolled here, or a new one with its public key
    let device = null;
    let key;
    if (deviceId) {
      if (!isUuid(deviceId)) return res.status(400).json({ error: SETUP_FAILED });
      device = (await pool.query('SELECT id, name, status, school_id, public_key FROM devices WHERE id = $1', [deviceId])).rows[0];
      if (!device || device.status === 'revoked') {
        return res.status(409).json({ error: 'This device has been removed. Set it up again as a new device.', deviceRevoked: true });
      }
      key = device.public_key;
    } else {
      const badKey = devices.publicKeyError(publicKey);
      if (badKey) return res.status(400).json({ error: badKey });
      if (typeof deviceName !== 'string' || !deviceName.trim()) return res.status(400).json({ error: 'Give this device a name, e.g. Kitchen tablet' });
      key = devices.publicJwk(publicKey);
    }
    if (!devices.verifyDeviceSignature(key, signedChallenge, signature)) {
      return res.status(400).json({ error: 'This device could not prove it holds its key. Start again.' });
    }

    const user = await findStaff(email);
    if (!user) return res.status(401).json({ error: SETUP_FAILED });

    await client.query('BEGIN');
    if (activationCode) {
      if (!(await devices.useActivationCode(user.id, activationCode, client))) {
        await client.query('ROLLBACK');
        return res.status(401).json({ error: 'The activation code is not correct or has expired. Ask an administrator for a new one.' });
      }
      // The new password replaces any earlier one and ends other sessions
      await client.query(
        `UPDATE users SET password_hash = $1, password_changed_at = date_trunc('second', NOW()), updated_at = NOW() WHERE id = $2`,
        [await hashPassword(newPassword), user.id]
      );
    } else if (!(await bcrypt.compare(password, user.password_hash))) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: SETUP_FAILED });
    }

    if (device && device.school_id !== user.school_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'This device belongs to another school' });
    }
    if (!device) {
      device = (await client.query(
        `INSERT INTO devices (school_id, name, public_key, enrolled_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, status, school_id`,
        [user.school_id, deviceName.trim().slice(0, MAX_DEVICE_NAME), key, user.id]
      )).rows[0];
    }

    await client.query(
      `INSERT INTO device_users (device_id, user_id, pin_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (device_id, user_id)
       DO UPDATE SET pin_hash = EXCLUDED.pin_hash, failed_attempts = 0, locked_at = NULL, updated_at = NOW()`,
      [device.id, user.id, await bcrypt.hash(pin, 10)]
    );
    await client.query('COMMIT');

    res.status(201).json({ device: devicePublic(device), user: { name: user.name, email: user.email } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

/**
 * POST /api/devices/sign-in (public)
 * Body: { email, pin, deviceId, challenge, signature } → { token, expiresAt, user }
 */
async function signIn(req, res, next) {
  try {
    const { email, pin, deviceId, challenge: signedChallenge, signature } = req.body || {};
    if (!isUuid(deviceId) || typeof pin !== 'string') return res.status(400).json({ error: 'Email, PIN and device are required' });
    if (!(await consumeChallenge(signedChallenge, 'device'))) {
      return res.status(401).json({ error: 'This sign-in request has expired. Try again.' });
    }

    const device = (await pool.query('SELECT id, name, status, school_id, public_key FROM devices WHERE id = $1', [deviceId])).rows[0];
    if (!device || device.status === 'revoked') {
      return res.status(403).json({ error: 'This device has been removed by an administrator. Set it up again to keep using it.', deviceRevoked: true });
    }
    if (!devices.verifyDeviceSignature(device.public_key, signedChallenge, signature)) {
      return res.status(401).json({ error: 'This device could not prove it holds its key.' });
    }
    if (device.status !== 'approved') {
      return res.status(403).json({ error: 'This device is waiting for an administrator to approve it.', devicePending: true });
    }

    const user = await findStaff(email);
    const link = user && (await pool.query(
      'SELECT pin_hash, failed_attempts, locked_at FROM device_users WHERE device_id = $1 AND user_id = $2',
      [device.id, user.id]
    )).rows[0];
    if (!link || user.school_id !== device.school_id) {
      return res.status(401).json({ error: SIGN_IN_FAILED });
    }
    if (link.locked_at) {
      return res.status(423).json({ error: 'Too many wrong PINs on this device. Ask an administrator to unlock it.', locked: true });
    }

    if (!(await bcrypt.compare(pin, link.pin_hash))) {
      const updated = await pool.query(
        `UPDATE device_users
         SET failed_attempts = failed_attempts + 1,
             locked_at = CASE WHEN failed_attempts + 1 >= $3 THEN NOW() ELSE locked_at END,
             updated_at = NOW()
         WHERE device_id = $1 AND user_id = $2
         RETURNING failed_attempts, locked_at`,
        [device.id, user.id, MAX_PIN_ATTEMPTS]
      );
      const { failed_attempts: failed, locked_at: locked } = updated.rows[0];
      if (locked) return res.status(423).json({ error: 'Too many wrong PINs on this device. Ask an administrator to unlock it.', locked: true });
      const left = MAX_PIN_ATTEMPTS - failed;
      return res.status(401).json({ error: `${SIGN_IN_FAILED}. ${left === 1 ? '1 try' : `${left} tries`} left before this device locks.`, attemptsLeft: left });
    }

    await pool.query(
      'UPDATE device_users SET failed_attempts = 0, last_sign_in_at = NOW(), updated_at = NOW() WHERE device_id = $1 AND user_id = $2',
      [device.id, user.id]
    );
    await pool.query('UPDATE devices SET last_seen_at = NOW() WHERE id = $1', [device.id]);
    res.json({ ...(await sessionFor(user, { deviceId: device.id })), device: devicePublic(device) });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/devices → { devices } (administrators)
 * Every device with its school, who enrolled it, and the staff who can sign in on it.
 */
async function listDevices(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT d.id, d.name, d.status, d.school_id, s.name AS school_name, d.created_at, d.approved_at,
              d.revoked_at, d.last_seen_at, e.name AS enrolled_by_name,
              COALESCE(json_agg(json_build_object(
                'userId', u.id, 'name', u.name, 'email', u.email,
                'locked', du.locked_at IS NOT NULL, 'lastSignInAt', du.last_sign_in_at
              ) ORDER BY u.name) FILTER (WHERE u.id IS NOT NULL), '[]') AS staff
       FROM devices d
       JOIN schools s ON s.id = d.school_id
       LEFT JOIN users e ON e.id = d.enrolled_by
       LEFT JOIN device_users du ON du.device_id = d.id
       LEFT JOIN users u ON u.id = du.user_id
       GROUP BY d.id, s.name, e.name
       ORDER BY CASE d.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, s.name, d.created_at`
    );
    res.json({
      devices: result.rows.map((row) => ({
        ...devicePublic(row),
        createdAt: row.created_at,
        approvedAt: row.approved_at,
        revokedAt: row.revoked_at,
        lastSeenAt: row.last_seen_at,
        enrolledBy: row.enrolled_by_name,
        staff: row.staff,
      })),
    });
  } catch (error) {
    next(error);
  }
}

async function setStatus(req, res, next, status) {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Device not found' });
    const current = (await pool.query('SELECT status FROM devices WHERE id = $1', [req.params.id])).rows[0];
    if (!current) return res.status(404).json({ error: 'Device not found' });
    if (current.status === 'revoked') {
      return res.status(400).json({ error: 'A removed device cannot be used again; set it up as a new device' });
    }
    const result = await pool.query(
      status === 'approved'
        ? `UPDATE devices SET status = 'approved', approved_by = $2, approved_at = NOW() WHERE id = $1 RETURNING id, name, status, school_id`
        : `UPDATE devices SET status = 'revoked', revoked_by = $2, revoked_at = NOW() WHERE id = $1 RETURNING id, name, status, school_id`,
      [req.params.id, req.user.id]
    );
    res.json({ device: devicePublic(result.rows[0]) });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/devices/:id/approve (administrators)
 */
function approveDevice(req, res, next) {
  return setStatus(req, res, next, 'approved');
}

/**
 * POST /api/devices/:id/revoke (administrators)
 * Staff can no longer sign in on it, and its existing sessions stop working.
 */
function revokeDevice(req, res, next) {
  return setStatus(req, res, next, 'revoked');
}

/**
 * POST /api/devices/:id/users/:userId/unlock (administrators)
 * After too many wrong PINs.
 */
async function unlockDeviceUser(req, res, next) {
  try {
    if (!isUuid(req.params.id) || !isUuid(req.params.userId)) return res.status(404).json({ error: 'Not found' });
    const result = await pool.query(
      `UPDATE device_users SET failed_attempts = 0, locked_at = NULL, updated_at = NOW()
       WHERE device_id = $1 AND user_id = $2 RETURNING device_id`,
      [req.params.id, req.params.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  MAX_PIN_ATTEMPTS,
  challenge,
  enrol,
  signIn,
  listDevices,
  approveDevice,
  revokeDevice,
  unlockDeviceUser,
};
