const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getJwtSecret, getJwtExpiresIn } = require('../config/auth');
const { countPasskeys } = require('./passkeys');
const { isTotpEnabled } = require('./totp');

const BCRYPT_ROUNDS = 10;

/**
 * Columns that are safe to return. password_hash is never selected for responses.
 */
const PUBLIC_COLUMNS = 'id, name, email, role, school_id, is_active, created_at, updated_at';

/**
 * A user row in the shape the API returns.
 */
function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    schoolId: user.school_id || null,
    ...(user.school_name !== undefined && { schoolName: user.school_name }),
    isActive: user.is_active,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    ...(user.passkey_count !== undefined && { passkeyCount: Number(user.passkey_count) }),
    ...(user.totp_enabled !== undefined && { totpEnabled: Boolean(user.totp_enabled) }),
  };
}

function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * A signed session token for a user, with its expiry time.
 * extra: fields added to the returned user (not to the token), e.g. needsPasskey.
 * claims: extra fields signed into the token, e.g. { dev } for a school device.
 */
function issueSession(user, extra = {}, claims = {}) {
  const token = jwt.sign(
    { name: user.name, email: user.email, role: user.role, ...claims },
    getJwtSecret(),
    { subject: user.id, expiresIn: getJwtExpiresIn(), algorithm: 'HS256' }
  );
  const { exp } = jwt.decode(token);
  return {
    token,
    expiresAt: new Date(exp * 1000).toISOString(),
    user: { id: user.id, name: user.name, email: user.email, role: user.role, ...extra },
  };
}

/**
 * A session plus what the app needs to know about the account's sign-in methods:
 * administrators with neither a passkey nor an authenticator app are asked to add one.
 */
async function sessionFor(user, { deviceId } = {}) {
  const needsPasskey = user.role === 'admin'
    && (await countPasskeys(user.id)) === 0
    && !(await isTotpEnabled(user.id));
  const extra = { needsPasskey };
  if (user.school_id) extra.schoolId = user.school_id;
  if (deviceId) extra.deviceId = deviceId;
  return issueSession(user, extra, deviceId ? { dev: deviceId } : {});
}

module.exports = {
  PUBLIC_COLUMNS,
  publicUser,
  hashPassword,
  issueSession,
  sessionFor,
};
