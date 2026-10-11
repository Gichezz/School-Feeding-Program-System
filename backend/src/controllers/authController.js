const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const { getJwtSecret, getJwtExpiresIn } = require('../config/auth');

// Compared against when the email is unknown, so both cases take similar time
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
const INVALID_LOGIN = 'Invalid email or password';

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

/**
 * POST /api/auth/login
 * Body: { email, password } → { token, expiresAt, user }
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await pool.query(
      'SELECT id, name, email, role, password_hash FROM users WHERE lower(email) = lower($1)',
      [email.trim()]
    );
    const user = result.rows[0];
    const passwordMatches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !passwordMatches) {
      return res.status(401).json({ error: INVALID_LOGIN });
    }

    const token = jwt.sign(
      { name: user.name, email: user.email, role: user.role },
      getJwtSecret(),
      { subject: user.id, expiresIn: getJwtExpiresIn(), algorithm: 'HS256' }
    );
    const { exp } = jwt.decode(token);

    res.json({ token, expiresAt: new Date(exp * 1000).toISOString(), user: publicUser(user) });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/auth/me
 * The signed-in user, from the session token.
 */
function me(req, res) {
  res.json({ user: req.user });
}

module.exports = {
  login,
  me,
};
