const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const { getJwtSecret } = require('../config/auth');
const { isUuid } = require('../validation/records');

const SESSION_ENDED = 'Your session has ended, please sign in again';

/**
 * Require a valid session token: `Authorization: Bearer <token>`.
 * The account is checked on every request, so deactivating a user, resetting their
 * password or changing their role takes effect straight away.
 * Sets req.user = { id, name, email, role } from the database.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Sign in required' });
  }

  let payload;
  try {
    payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
  } catch (error) {
    const message = error.name === 'TokenExpiredError' ? 'Session expired, please sign in again' : 'Invalid session';
    return res.status(401).json({ error: message });
  }
  if (!isUuid(payload.sub)) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, email, role, is_active,
              floor(extract(epoch FROM password_changed_at))::bigint AS password_changed
       FROM users WHERE id = $1`,
      [payload.sub]
    );
    const user = result.rows[0];
    // Unknown or deactivated account, or a session from before a password change
    if (!user || !user.is_active || (user.password_changed !== null && payload.iat < Number(user.password_changed))) {
      return res.status(401).json({ error: SESSION_ENDED });
    }
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Allow only the given roles. Use after requireAuth.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do this' });
    }
    return next();
  };
}

module.exports = {
  requireAuth,
  requireRole,
};
