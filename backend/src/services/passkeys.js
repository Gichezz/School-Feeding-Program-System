const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');

const CHALLENGE_TTL_MINUTES = 5;
const RECOVERY_CODE_COUNT = 10;
// No 0/O or 1/I, so codes are easy to read and type
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Store a challenge for one registration or sign-in. Expired ones are cleared out.
 */
async function saveChallenge(challenge, purpose, userId = null) {
  await pool.query('DELETE FROM auth_challenges WHERE expires_at < NOW()');
  await pool.query(
    `INSERT INTO auth_challenges (challenge, purpose, user_id, expires_at)
     VALUES ($1, $2, $3, NOW() + make_interval(mins => $4))`,
    [challenge, purpose, userId, CHALLENGE_TTL_MINUTES]
  );
}

/**
 * The challenge inside a browser response (clientDataJSON), or null.
 */
function challengeFromResponse(response) {
  try {
    const clientData = JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8'));
    return typeof clientData.challenge === 'string' ? clientData.challenge : null;
  } catch {
    return null;
  }
}

/**
 * Use up a stored challenge: returns true once for a valid, unexpired challenge that
 * matches the purpose (and user, for registration), then never again.
 */
async function consumeChallenge(challenge, purpose, userId = null) {
  if (!challenge) return false;
  const result = await pool.query(
    `DELETE FROM auth_challenges
     WHERE challenge = $1 AND purpose = $2 AND expires_at > NOW()
       AND user_id IS NOT DISTINCT FROM $3
     RETURNING id`,
    [challenge, purpose, userId]
  );
  return result.rows.length === 1;
}

function publicPasskey(row) {
  return { id: row.id, name: row.name, createdAt: row.created_at, lastUsedAt: row.last_used_at };
}

async function listPasskeys(userId) {
  const result = await pool.query(
    'SELECT id, name, created_at, last_used_at FROM passkey_credentials WHERE user_id = $1 ORDER BY created_at',
    [userId]
  );
  return result.rows.map(publicPasskey);
}

async function countPasskeys(userId) {
  const result = await pool.query('SELECT count(*)::int AS n FROM passkey_credentials WHERE user_id = $1', [userId]);
  return result.rows[0].n;
}

async function credentialDescriptors(userId) {
  const result = await pool.query('SELECT credential_id, transports FROM passkey_credentials WHERE user_id = $1', [userId]);
  return result.rows.map((row) => ({ id: row.credential_id, transports: row.transports }));
}

/**
 * A stored credential and its owner, by the credential ID the browser sent.
 */
async function findCredential(credentialId) {
  const result = await pool.query(
    `SELECT pc.id, pc.credential_id, pc.public_key, pc.counter, pc.transports,
            u.id AS user_id, u.name, u.email, u.role, u.is_active
     FROM passkey_credentials pc JOIN users u ON u.id = pc.user_id
     WHERE pc.credential_id = $1`,
    [credentialId]
  );
  return result.rows[0] || null;
}

function generateRecoveryCode() {
  const bytes = crypto.randomBytes(10);
  const chars = [...bytes].map((byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

/**
 * Codes are compared without dashes, spaces or letter case.
 */
function normaliseRecoveryCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Replace a user's recovery codes with a new set. Returns the codes; only hashes are kept.
 */
async function replaceRecoveryCodes(userId, client = pool) {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  const hashes = await Promise.all(codes.map((code) => bcrypt.hash(normaliseRecoveryCode(code), 10)));
  await client.query('DELETE FROM recovery_codes WHERE user_id = $1', [userId]);
  for (const hash of hashes) {
    await client.query('INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, $2)', [userId, hash]);
  }
  return codes;
}

async function countRecoveryCodes(userId) {
  const result = await pool.query('SELECT count(*)::int AS n FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL', [userId]);
  return result.rows[0].n;
}

/**
 * Spend one unused recovery code. Returns true if the code matched.
 */
async function useRecoveryCode(userId, code) {
  const normalised = normaliseRecoveryCode(code);
  if (normalised.length !== 10) return false;
  const result = await pool.query('SELECT id, code_hash FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL', [userId]);
  for (const row of result.rows) {
    if (await bcrypt.compare(normalised, row.code_hash)) {
      const spent = await pool.query('UPDATE recovery_codes SET used_at = NOW() WHERE id = $1 AND used_at IS NULL RETURNING id', [row.id]);
      return spent.rows.length === 1;
    }
  }
  return false;
}

module.exports = {
  saveChallenge,
  challengeFromResponse,
  consumeChallenge,
  listPasskeys,
  countPasskeys,
  credentialDescriptors,
  findCredential,
  replaceRecoveryCodes,
  countRecoveryCodes,
  useRecoveryCode,
  normaliseRecoveryCode,
};
