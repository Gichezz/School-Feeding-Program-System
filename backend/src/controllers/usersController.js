const { pool } = require('../db/pool');
const { isUuid } = require('../validation/records');
const crypto = require('crypto');
const { PUBLIC_COLUMNS, publicUser, hashPassword } = require('../services/userAccounts');
const { issueActivationCode } = require('../services/devices');
const { isEmailConfigured, activationEmail } = require('../services/mailer');
const { deliver, recordAccountEvent, accountHistory } = require('../services/emailDelivery');
const { nameError, emailError, roleError, passwordError, normaliseEmail } = require('../validation/users');

/**
 * User account management. Every route here is admin-only (see usersRoutes.js).
 */

function badRequest(res, error) {
  return res.status(400).json({ error });
}

async function schoolExists(id) {
  if (!isUuid(id)) return false;
  return (await pool.query('SELECT 1 FROM schools WHERE id = $1', [id])).rows.length === 1;
}

/** A sub-county the programme has schools in. */
async function subCountyExists(name) {
  if (typeof name !== 'string' || !name.trim()) return false;
  return (await pool.query('SELECT 1 FROM schools WHERE sub_county = $1 LIMIT 1', [name.trim()])).rows.length === 1;
}

/**
 * Email a feeding teacher a new activation code. The code goes only to their address, so
 * only its owner can activate, and the address is verified when they do. The
 * administrator never sees it: they see whether the provider accepted the email, and can
 * send a new one. Without email set up nothing is sent and the account waits; handing a
 * code over in person is a separate, recorded action (handOverActivation).
 * Returns { status: 'accepted' | 'failed' | 'not_sent', expiresAt? }.
 */
async function emailActivation(user, actorId) {
  if (!isEmailConfigured()) return { status: 'not_sent', emailConfigured: false };
  const activation = await issueActivationCode(user.id, actorId, { emailed: true });
  const sent = await deliver({
    kind: 'activation', userId: user.id, to: user.email,
    message: activationEmail({ name: user.name, code: activation.code, expiresAt: activation.expiresAt }),
  });
  await recordAccountEvent(pool, { userId: user.id, actorId, kind: sent.status === 'accepted' ? 'activation_emailed' : 'activation_email_failed' });
  return { status: sent.status, emailConfigured: true, expiresAt: activation.expiresAt };
}

/**
 * Whether each feeding teacher has activated their account, and the state of the last
 * activation email, for the accounts list.
 */
const ACTIVATION_COLUMNS = `,
  EXISTS (SELECT 1 FROM activation_codes a WHERE a.user_id = users.id AND a.used_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM device_users du WHERE du.user_id = users.id) AS activated,
  (SELECT status FROM email_deliveries d WHERE d.user_id = users.id AND d.kind = 'activation'
   ORDER BY d.created_at DESC LIMIT 1) AS activation_email,
  (SELECT expires_at FROM activation_codes a WHERE a.user_id = users.id AND a.used_at IS NULL AND a.expires_at > NOW()
   ORDER BY a.created_at DESC LIMIT 1) AS activation_expires_at`;

function withActivation(row) {
  const user = publicUser(row);
  if (row.role !== 'school_staff') return user;
  return {
    ...user,
    activation: {
      activated: Boolean(row.activated),
      email: row.activation_email || null,
      codeExpiresAt: row.activation_expires_at || null,
    },
  };
}

async function findUser(id) {
  if (!isUuid(id)) return null;
  const result = await pool.query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

/**
 * GET /api/users → { users }
 * Active users first, then by name.
 */
async function listUsers(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT ${PUBLIC_COLUMNS.split(', ').map((c) => `users.${c}`).join(', ')}, schools.name AS school_name,
              (SELECT count(*) FROM passkey_credentials pc WHERE pc.user_id = users.id) AS passkey_count,
              EXISTS (SELECT 1 FROM totp_credentials t WHERE t.user_id = users.id AND t.confirmed_at IS NOT NULL) AS totp_enabled
              ${ACTIVATION_COLUMNS}
       FROM users LEFT JOIN schools ON schools.id = users.school_id
       ORDER BY users.is_active DESC, lower(users.name)`
    );
    res.json({ users: result.rows.map(withActivation) });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/users
 * System administrators: { name, email, role: 'admin', password } → 201 { user }
 * Programme officers: { name, email, role: 'programme_officer', password, subCounty } → 201 { user }
 * Feeding teachers: { name, email, role: 'school_staff', schoolId }
 *   → 201 { user, activation: { status: 'accepted' | 'failed' | 'not_sent', expiresAt? } }
 *   The activation code is emailed to them and never returned here. They set their own
 *   password and PIN when they set up a school device with it (#60).
 */
async function createUser(req, res, next) {
  try {
    const { name, email, role, password, schoolId, subCounty } = req.body || {};
    const isStaff = role === 'school_staff';
    const isOfficer = role === 'programme_officer';
    const invalid = nameError(name) || emailError(email) || roleError(role) || (isStaff ? null : passwordError(password));
    if (invalid) return badRequest(res, invalid);
    if (isStaff && !(await schoolExists(schoolId))) return badRequest(res, 'Choose the school this feeding teacher works at');
    if (isOfficer && !(await subCountyExists(subCounty))) return badRequest(res, 'Choose the sub-county this programme officer covers');

    const address = normaliseEmail(email);
    const existing = await pool.query('SELECT 1 FROM users WHERE lower(email) = $1', [address]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'There is already an account with this email address' });
    }

    // Staff get an unusable random password until they activate their account
    const initialPassword = isStaff ? crypto.randomBytes(32).toString('base64url') : password;
    const result = await pool.query(
      `INSERT INTO users (name, email, role, password_hash, school_id, sub_county)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${PUBLIC_COLUMNS}`,
      [name.trim(), address, role, await hashPassword(initialPassword), isStaff ? schoolId : null, isOfficer ? subCounty.trim() : null]
    );
    const user = result.rows[0];
    if (!isStaff) return res.status(201).json({ user: publicUser(user) });
    res.status(201).json({ user: publicUser(user), activation: await emailActivation(user, req.user.id) });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/users/:id
 * Body: any of { name, role, isActive, schoolId, subCounty } → { user }
 * Feeding teachers (school_staff) must have a school, programme officers a sub-county;
 * system administrators have neither.
 * Administrators cannot change their own role or deactivate themselves, so there is
 * always at least one active administrator.
 */
async function updateUser(req, res, next) {
  try {
    const user = await findUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { name, role, isActive, schoolId, subCounty } = req.body || {};
    if (name === undefined && role === undefined && isActive === undefined && schoolId === undefined && subCounty === undefined) {
      return badRequest(res, 'Nothing to change: send name, role, isActive, schoolId or subCounty');
    }
    if (subCounty !== undefined && subCounty !== null && !(await subCountyExists(subCounty))) {
      return badRequest(res, 'That sub-county has no schools in the programme');
    }
    if (schoolId !== undefined && schoolId !== null && !(await schoolExists(schoolId))) {
      return badRequest(res, 'That school does not exist');
    }
    if (name !== undefined && nameError(name)) return badRequest(res, nameError(name));
    if (role !== undefined && roleError(role)) return badRequest(res, roleError(role));
    if (isActive !== undefined && typeof isActive !== 'boolean') return badRequest(res, 'isActive must be true or false');

    const isSelf = user.id === req.user.id;
    if (isSelf && role !== undefined && role !== user.role) {
      return badRequest(res, 'You cannot change your own role. Ask another system administrator.');
    }
    if (isSelf && isActive === false) {
      return badRequest(res, 'You cannot deactivate your own account. Ask another system administrator.');
    }

    const newRole = role ?? user.role;
    const newSchool = newRole !== 'school_staff' ? null : (schoolId !== undefined ? schoolId : user.school_id);
    if (newRole === 'school_staff' && !newSchool) {
      return badRequest(res, 'Choose the school this feeding teacher works at');
    }
    const newSubCounty = newRole !== 'programme_officer' ? null
      : (subCounty !== undefined ? (subCounty && subCounty.trim()) : user.sub_county);
    if (newRole === 'programme_officer' && !newSubCounty) {
      return badRequest(res, 'Choose the sub-county this programme officer covers');
    }

    const result = await pool.query(
      `UPDATE users
       SET name = COALESCE($1, name), role = COALESCE($2, role), is_active = COALESCE($3, is_active),
           school_id = $5, sub_county = $6, updated_at = NOW()
       WHERE id = $4
       RETURNING ${PUBLIC_COLUMNS}`,
      [name === undefined ? null : name.trim(), role ?? null, isActive ?? null, user.id, newSchool, newSubCounty]
    );
    res.json({ user: publicUser(result.rows[0]) });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/users/:id/password
 * Body: { password } → { user }
 * Sets a new password and ends the user's existing sessions.
 */
async function resetPassword(req, res, next) {
  try {
    const user = await findUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { password } = req.body || {};
    const invalid = passwordError(password);
    if (invalid) return badRequest(res, invalid);

    const result = await pool.query(
      `UPDATE users
       SET password_hash = $1, password_changed_at = date_trunc('second', NOW()),
           password_reset_at = NOW(), updated_at = NOW()
       WHERE id = $2
       RETURNING ${PUBLIC_COLUMNS}`,
      [await hashPassword(password), user.id]
    );
    res.json({ user: publicUser(result.rows[0]) });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/users/:id/passkeys/reset → { user }
 * For an administrator who lost their passkeys or authenticator app: removes their
 * passkeys, authenticator app (#63) and recovery codes, and ends their sessions. They
 * sign in with their password and set up a passkey or authenticator app again.
 */
async function resetPasskeys(req, res, next) {
  try {
    const user = await findUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.id === req.user.id) {
      return badRequest(res, 'You cannot reset your own passkeys. Ask another system administrator.');
    }
    await pool.query('DELETE FROM passkey_credentials WHERE user_id = $1', [user.id]);
    await pool.query('DELETE FROM recovery_codes WHERE user_id = $1', [user.id]);
    await pool.query('DELETE FROM totp_credentials WHERE user_id = $1', [user.id]);
    // password_changed_at doubles as "sessions issued before this time end"
    const result = await pool.query(
      `UPDATE users SET password_changed_at = date_trunc('second', NOW()), updated_at = NOW()
       WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
      [user.id]
    );
    res.json({ user: publicUser({ ...result.rows[0], passkey_count: 0, totp_enabled: false }) });
  } catch (error) {
    next(error);
  }
}

async function staffForActivation(req, res) {
  const user = await findUser(req.params.id);
  if (!user) { res.status(404).json({ error: 'User not found' }); return null; }
  if (user.role !== 'school_staff') { badRequest(res, 'Activation codes are for feeding teachers'); return null; }
  if (!user.is_active) { badRequest(res, 'Reactivate this user first'); return null; }
  return user;
}

/**
 * POST /api/users/:id/activation/email → { activation: { status, expiresAt } }
 * Email a new one-time code (first set-up, a lost email, or a forgotten password); any
 * earlier unused code stops working. The code is never returned.
 */
async function resendActivation(req, res, next) {
  try {
    const user = await staffForActivation(req, res);
    if (!user) return undefined;
    if (!isEmailConfigured()) return badRequest(res, 'Email is not set up on this server');
    return res.json({ activation: await emailActivation(user, req.user.id) });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/users/:id/activation/hand-over  { note } → { activationCode, expiresAt }
 * For a teacher who cannot get email: a new code for the administrator to give them in
 * person. It is a deliberate, recorded action: the note (for example "No email access;
 * given at the sub-county office") is kept with who did it and when, in the account's
 * history. The address stays unverified. Any earlier unused code stops working.
 */
async function handOverActivation(req, res, next) {
  try {
    const user = await staffForActivation(req, res);
    if (!user) return undefined;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!note) return badRequest(res, 'Say why the code is being handed over, and how');
    if (note.length > 500) return badRequest(res, 'Keep the note to 500 characters');
    const activation = await issueActivationCode(user.id, req.user.id);
    await recordAccountEvent(pool, { userId: user.id, actorId: req.user.id, kind: 'activation_handed_over', note });
    return res.json({ activationCode: activation.code, expiresAt: activation.expiresAt });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/users/:id/history → { events, emails }
 * What happened to the account and who did it, and every email sent for it.
 */
async function getAccountHistory(req, res, next) {
  try {
    const user = await findUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json(await accountHistory(user.id));
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listUsers,
  resendActivation,
  handOverActivation,
  getAccountHistory,
  createUser,
  updateUser,
  resetPassword,
  resetPasskeys,
};
