const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const { getJwtSecret } = require('../config/auth');
const { isUuid } = require('../validation/records');

const SESSION_ENDED = 'Your session has ended, please sign in again';

/**
 * Require a valid session token: `Authorization: Bearer <token>`.
 * The account is checked on every request, so deactivating a user, resetting their
 * password or changing their role takes effect straight away.
 * School staff sessions also belong to an approved school device at their own school
 * (#60), so revoking a device ends its sessions at once.
 * Sets req.user = { id, name, email, role, schoolId, deviceId } from the database.
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
      `SELECT u.id, u.name, u.email, u.role, u.school_id, u.is_active,
              floor(extract(epoch FROM u.password_changed_at))::bigint AS password_changed,
              d.status AS device_status, d.school_id AS device_school_id
       FROM users u
       LEFT JOIN devices d ON d.id = $2
       WHERE u.id = $1`,
      [payload.sub, isUuid(payload.dev) ? payload.dev : null]
    );
    const user = result.rows[0];
    // Unknown or deactivated account, or a session from before a password change
    if (!user || !user.is_active || (user.password_changed !== null && payload.iat < Number(user.password_changed))) {
      return res.status(401).json({ error: SESSION_ENDED });
    }
    if (user.role === 'school_staff' && (user.device_status !== 'approved' || user.device_school_id !== user.school_id)) {
      return res.status(401).json({
        error: user.device_status === 'revoked'
          ? 'This device has been removed by an administrator. Set it up again to keep using it.'
          : SESSION_ENDED,
        ...(user.device_status === 'revoked' && { deviceRevoked: true }),
      });
    }
    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      schoolId: user.school_id,
      deviceId: user.role === 'school_staff' ? payload.dev : null,
    };
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
