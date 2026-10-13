const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const { hashPassword, sessionFor } = require('../services/userAccounts');
const { countPasskeys } = require('../services/passkeys');
const { passwordError } = require('../validation/users');

// Compared against when the email is unknown, so both cases take similar time
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
const INVALID_LOGIN = 'Invalid email or password';

/**
 * POST /api/auth/login
 * Body: { email, password } → { token, expiresAt, user }
 * Deactivated accounts get the same message as a wrong password. Accounts with a
 * passkey (administrators, #57) cannot sign in with a password alone.
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await pool.query(
      'SELECT id, name, email, role, is_active, password_hash FROM users WHERE lower(email) = lower($1)',
      [email.trim()]
    );
    const user = result.rows[0];
    const passwordMatches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !passwordMatches || !user.is_active) {
      return res.status(401).json({ error: INVALID_LOGIN });
    }

    if ((await countPasskeys(user.id)) > 0) {
      return res.status(403).json({
        error: 'This account signs in with a passkey. Use "Sign in with a passkey", or a recovery code if you cannot.',
        passkeyRequired: true,
      });
    }

    res.json(await sessionFor(user));
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/auth/me
 * The signed-in user, from the session token.
 */
async function me(req, res, next) {
  try {
    const needsPasskey = req.user.role === 'admin' && (await countPasskeys(req.user.id)) === 0;
    res.json({ user: { ...req.user, needsPasskey } });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/auth/password
 * Body: { currentPassword, newPassword } → { token, expiresAt, user }
 * Ends every other session for this user; the new token keeps this device signed in.
 */
async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || !currentPassword) {
      return res.status(400).json({ error: 'Enter your current password' });
    }
    const invalid = passwordError(newPassword);
    if (invalid) return res.status(400).json({ error: invalid });
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: 'The new password must be different from the current one' });
    }

    const result = await pool.query('SELECT id, name, email, role, password_hash FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(400).json({ error: 'Your current password is not correct' });
    }

    await pool.query(
      `UPDATE users
       SET password_hash = $1, password_changed_at = date_trunc('second', NOW()), updated_at = NOW()
       WHERE id = $2`,
      [await hashPassword(newPassword), user.id]
    );
    res.json(await sessionFor(user));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  login,
  me,
  changePassword,
};
