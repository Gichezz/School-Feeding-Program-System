const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getJwtSecret, getJwtExpiresIn } = require('../config/auth');

const BCRYPT_ROUNDS = 10;

/**
 * Columns that are safe to return. password_hash is never selected for responses.
 */
const PUBLIC_COLUMNS = 'id, name, email, role, is_active, created_at, updated_at';

/**
 * A user row in the shape the API returns.
 */
function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.is_active,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * A signed session token for a user, with its expiry time.
 */
function issueSession(user) {
  const token = jwt.sign(
    { name: user.name, email: user.email, role: user.role },
    getJwtSecret(),
    { subject: user.id, expiresIn: getJwtExpiresIn(), algorithm: 'HS256' }
  );
  const { exp } = jwt.decode(token);
  return {
    token,
    expiresAt: new Date(exp * 1000).toISOString(),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
}

module.exports = {
  PUBLIC_COLUMNS,
  publicUser,
  hashPassword,
  issueSession,
};
