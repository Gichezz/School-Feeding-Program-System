const { pool } = require('../db/pool');
const { isUuid } = require('../validation/records');
const { PUBLIC_COLUMNS, publicUser, hashPassword } = require('../services/userAccounts');
const { nameError, emailError, roleError, passwordError, normaliseEmail } = require('../validation/users');

/**
 * User account management. Every route here is admin-only (see usersRoutes.js).
 */

function badRequest(res, error) {
  return res.status(400).json({ error });
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
    const result = await pool.query(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY is_active DESC, lower(name)`);
    res.json({ users: result.rows.map(publicUser) });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/users
 * Body: { name, email, role, password } → 201 { user }
 */
async function createUser(req, res, next) {
  try {
    const { name, email, role, password } = req.body || {};
    const invalid = nameError(name) || emailError(email) || roleError(role) || passwordError(password);
    if (invalid) return badRequest(res, invalid);

    const address = normaliseEmail(email);
    const existing = await pool.query('SELECT 1 FROM users WHERE lower(email) = $1', [address]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'There is already an account with this email address' });
    }

    const result = await pool.query(
      `INSERT INTO users (name, email, role, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING ${PUBLIC_COLUMNS}`,
      [name.trim(), address, role, await hashPassword(password)]
    );
    res.status(201).json({ user: publicUser(result.rows[0]) });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/users/:id
 * Body: any of { name, role, isActive } → { user }
 * Administrators cannot change their own role or deactivate themselves, so there is
 * always at least one active administrator.
 */
async function updateUser(req, res, next) {
  try {
    const user = await findUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { name, role, isActive } = req.body || {};
    if (name === undefined && role === undefined && isActive === undefined) {
      return badRequest(res, 'Nothing to change: send name, role or isActive');
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

    const result = await pool.query(
      `UPDATE users
       SET name = COALESCE($1, name), role = COALESCE($2, role), is_active = COALESCE($3, is_active), updated_at = NOW()
       WHERE id = $4
       RETURNING ${PUBLIC_COLUMNS}`,
      [name === undefined ? null : name.trim(), role ?? null, isActive ?? null, user.id]
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
       SET password_hash = $1, password_changed_at = date_trunc('second', NOW()), updated_at = NOW()
       WHERE id = $2
       RETURNING ${PUBLIC_COLUMNS}`,
      [await hashPassword(password), user.id]
    );
    res.json({ user: publicUser(result.rows[0]) });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listUsers,
  createUser,
  updateUser,
  resetPassword,
};
