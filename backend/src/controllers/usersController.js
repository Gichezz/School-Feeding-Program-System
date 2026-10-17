const { pool } = require('../db/pool');
const { isUuid } = require('../validation/records');
const crypto = require('crypto');
const { PUBLIC_COLUMNS, publicUser, hashPassword } = require('../services/userAccounts');
const { issueActivationCode } = require('../services/devices');
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
       FROM users LEFT JOIN schools ON schools.id = users.school_id
       ORDER BY users.is_active DESC, lower(users.name)`
    );
    res.json({ users: result.rows.map(publicUser) });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/users
 * Administrators: { name, email, role: 'admin', password } → 201 { user }
 * School staff: { name, email, role: 'school_staff', schoolId } → 201 { user, activationCode, activationExpiresAt }
 *   Staff set their own password and PIN when they set up a school device with the
 *   one-time activation code (#60), so no password is chosen for them.
 */
async function createUser(req, res, next) {
  try {
    const { name, email, role, password, schoolId } = req.body || {};
    const isStaff = role === 'school_staff';
    const invalid = nameError(name) || emailError(email) || roleError(role) || (isStaff ? null : passwordError(password));
    if (invalid) return badRequest(res, invalid);
    if (isStaff && !(await schoolExists(schoolId))) return badRequest(res, 'Choose the school this staff member works at');

    const address = normaliseEmail(email);
    const existing = await pool.query('SELECT 1 FROM users WHERE lower(email) = $1', [address]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'There is already an account with this email address' });
    }

    // Staff get an unusable random password until they activate their account
    const initialPassword = isStaff ? crypto.randomBytes(32).toString('base64url') : password;
    const result = await pool.query(
      `INSERT INTO users (name, email, role, password_hash, school_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${PUBLIC_COLUMNS}`,
      [name.trim(), address, role, await hashPassword(initialPassword), isStaff ? schoolId : null]
    );
    const user = result.rows[0];
    if (!isStaff) return res.status(201).json({ user: publicUser(user) });
    const activation = await issueActivationCode(user.id, req.user.id);
    res.status(201).json({ user: publicUser(user), activationCode: activation.code, activationExpiresAt: activation.expiresAt });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/users/:id
 * Body: any of { name, role, isActive, schoolId } → { user }
 * School staff must have a school; administrators have none.
 * Administrators cannot change their own role or deactivate themselves, so there is
 * always at least one active administrator.
 */
async function updateUser(req, res, next) {
  try {
    const user = await findUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { name, role, isActive, schoolId } = req.body || {};
    if (name === undefined && role === undefined && isActive === undefined && schoolId === undefined) {
      return badRequest(res, 'Nothing to change: send name, role, isActive or schoolId');
    }
    if (schoolId !== undefined && schoolId !== null && !(await schoolExists(schoolId))) {
      return badRequest(res, 'That school does not exist');
    }
    if (name !== undefined && nameError(name)) return badRequest(res, nameError(name));
    if (role !== undefined && roleError(role)) return badRequest(res, roleError(role));
    if (isActive !== undefined && typeof isActive !== 'boolean') return badRequest(res, 'isActive must be true or false');

    const isSelf = user.id === req.user.id;
    if (isSelf && role !== undefined && role !== user.role) {
      return badRequest(res, 'You cannot change your own role. Ask another administrator.');
    }
    if (isSelf && isActive === false) {
      return badRequest(res, 'You cannot deactivate your own account. Ask another administrator.');
    }

    const newRole = role ?? user.role;
    const newSchool = newRole === 'admin' ? null : (schoolId !== undefined ? schoolId : user.school_id);
    if (newRole === 'school_staff' && !newSchool) {
      return badRequest(res, 'Choose the school this staff member works at');
    }

    const result = await pool.query(
      `UPDATE users
       SET name = COALESCE($1, name), role = COALESCE($2, role), is_active = COALESCE($3, is_active),
           school_id = $5, updated_at = NOW()
       WHERE id = $4
       RETURNING ${PUBLIC_COLUMNS}`,
      [name === undefined ? null : name.trim(), role ?? null, isActive ?? null, user.id, newSchool]
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
      return badRequest(res, 'You cannot reset your own passkeys. Ask another administrator.');
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

/**
 * POST /api/users/:id/activation-code → { activationCode, expiresAt }
 * A new one-time code for a staff member (first set-up, or a forgotten password);
 * any earlier unused code stops working.
 */
async function newActivationCode(req, res, next) {
  try {
    const user = await findUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role !== 'school_staff') return badRequest(res, 'Activation codes are for school staff');
    if (!user.is_active) return badRequest(res, 'Reactivate this user first');
    const activation = await issueActivationCode(user.id, req.user.id);
    res.json({ activationCode: activation.code, expiresAt: activation.expiresAt });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listUsers,
  newActivationCode,
  createUser,
  updateUser,
  resetPassword,
  resetPasskeys,
};
