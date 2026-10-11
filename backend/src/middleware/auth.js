const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/auth');

/**
 * Require a valid session token: `Authorization: Bearer <token>`.
 * Sets req.user = { id, name, email, role }.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Sign in required' });
  }

  try {
    const payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
    req.user = { id: payload.sub, name: payload.name, email: payload.email, role: payload.role };
    return next();
  } catch (error) {
    const message = error.name === 'TokenExpiredError' ? 'Session expired, please sign in again' : 'Invalid session';
    return res.status(401).json({ error: message });
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
