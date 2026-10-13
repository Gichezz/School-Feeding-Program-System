const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');

/**
 * School devices (#60). Each device creates a P-256 key pair in the browser with
 * WebCrypto; the private key is non-extractable and never leaves the device. The server
 * keeps the public key (JWK) and checks that sign-in challenges are signed with it.
 */

const ACTIVATION_TTL_HOURS = 48;
// No 0/O or 1/I, so codes are easy to read out and type
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * A device public key as a JWK, or an error message. Private key material is refused.
 */
function publicKeyError(jwk) {
  if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk)) return 'A device public key is required';
  if (jwk.d !== undefined) return 'Send the public key only';
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') {
    return 'The device key must be a P-256 public key';
  }
  try {
    crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
    return null;
  } catch {
    return 'The device key is not a valid P-256 public key';
  }
}

/**
 * Only the public parts of a JWK are stored.
 */
function publicJwk(jwk) {
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}

/**
 * True when signature (base64url, raw r||s as WebCrypto produces) is a valid ECDSA
 * P-256 / SHA-256 signature of the challenge text by the device's key.
 */
function verifyDeviceSignature(jwk, challenge, signature) {
  if (typeof challenge !== 'string' || typeof signature !== 'string') return false;
  try {
    const key = crypto.createPublicKey({ key: publicJwk(jwk), format: 'jwk' });
    return crypto.verify(
      'sha256',
      Buffer.from(challenge, 'utf8'),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url')
    );
  } catch {
    return false;
  }
}

function newChallenge() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateActivationCode() {
  const chars = [...crypto.randomBytes(12)].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

/**
 * Codes are compared without dashes, spaces or letter case.
 */
function normaliseCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Issue a new activation code for a staff member; any earlier unused code stops working.
 * Returns { code, expiresAt }; only a hash is stored.
 */
async function issueActivationCode(userId, createdBy) {
  const code = generateActivationCode();
  await pool.query('DELETE FROM activation_codes WHERE user_id = $1 AND used_at IS NULL', [userId]);
  const result = await pool.query(
    `INSERT INTO activation_codes (user_id, code_hash, created_by, expires_at)
     VALUES ($1, $2, $3, NOW() + make_interval(hours => $4))
     RETURNING expires_at`,
    [userId, await bcrypt.hash(normaliseCode(code), 10), createdBy, ACTIVATION_TTL_HOURS]
  );
  return { code, expiresAt: result.rows[0].expires_at };
}

/**
 * Spend the user's unexpired activation code if it matches. Returns true once.
 */
async function useActivationCode(userId, code, client = pool) {
  const normalised = normaliseCode(code);
  if (normalised.length !== 12) return false;
  const result = await client.query(
    'SELECT id, code_hash FROM activation_codes WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()',
    [userId]
  );
  for (const row of result.rows) {
    if (await bcrypt.compare(normalised, row.code_hash)) {
      const spent = await client.query('UPDATE activation_codes SET used_at = NOW() WHERE id = $1 AND used_at IS NULL RETURNING id', [row.id]);
      return spent.rows.length === 1;
    }
  }
  return false;
}

module.exports = {
  ACTIVATION_TTL_HOURS,
  publicKeyError,
  publicJwk,
  verifyDeviceSignature,
  newChallenge,
  issueActivationCode,
  useActivationCode,
  normaliseCode,
};
