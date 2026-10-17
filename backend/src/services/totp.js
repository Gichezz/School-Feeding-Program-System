const crypto = require('crypto');
const QRCode = require('qrcode');
const { pool } = require('../db/pool');
const { getJwtSecret } = require('../config/auth');
const clock = require('../utils/clock');

/**
 * Authenticator app codes (TOTP, RFC 6238) for administrators (#63), as a second
 * option beside passkeys. The server checks every code, so this only works online,
 * which suits administrators. Secrets are stored encrypted (AES-256-GCM) and are never
 * returned after set-up. A code is accepted once, within one 30-second step either
 * side of now; 5 wrong codes in a row pause code sign-in for 15 minutes.
 */

const ISSUER = 'Lishe';
const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW_STEPS = 1;
const SECRET_BYTES = 20;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * The key that encrypts secrets: TOTP_ENCRYPTION_KEY (64 hex characters) when set,
 * otherwise derived from JWT_SECRET, so no extra setting is required. Changing the
 * key that is in use means administrators set up their authenticator app again.
 */
function encryptionKey() {
  const configured = process.env.TOTP_ENCRYPTION_KEY;
  if (configured) {
    if (!/^[0-9a-fA-F]{64}$/.test(configured)) throw new Error('TOTP_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    return Buffer.from(configured, 'hex');
  }
  return Buffer.from(crypto.hkdfSync('sha256', getJwtSecret(), 'lishe-totp', 'totp-secret-encryption', 32));
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join('.');
}

function decrypt(stored) {
  const [iv, tag, data] = stored.split('.').map((part) => Buffer.from(part, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of text.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function currentStep(now = clock.now()) {
  return Math.floor(now.getTime() / 1000 / STEP_SECONDS);
}

/**
 * The 6-digit code for a base32 secret at a time step (RFC 4226 / 6238, HMAC-SHA1).
 */
function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const number = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(number).padStart(DIGITS, '0');
}

/**
 * The time step a code matches within the window, or null. Compared in constant time.
 */
function matchingStep(secret, code, now = clock.now()) {
  const text = String(code || '').replace(/\s/g, '');
  if (!new RegExp(`^\\d{${DIGITS}}$`).test(text)) return null;
  const step = currentStep(now);
  for (let offset = -WINDOW_STEPS; offset <= WINDOW_STEPS; offset += 1) {
    const expected = codeAt(secret, step + offset);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(text))) return step + offset;
  }
  return null;
}

async function findTotp(userId, client = pool) {
  return (await client.query('SELECT * FROM totp_credentials WHERE user_id = $1', [userId])).rows[0] || null;
}

async function isTotpEnabled(userId) {
  const row = await findTotp(userId);
  return Boolean(row?.confirmed_at);
}

/**
 * Start set-up: a new secret (replacing any unconfirmed one) and the QR code to scan.
 * Returns null when TOTP is already on for this user.
 */
async function startSetup(user) {
  const existing = await findTotp(user.id);
  if (existing?.confirmed_at) return null;
  const secret = base32Encode(crypto.randomBytes(SECRET_BYTES));
  await pool.query(
    `INSERT INTO totp_credentials (user_id, secret_encrypted) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET secret_encrypted = EXCLUDED.secret_encrypted, created_at = NOW(),
       last_used_step = NULL, failed_attempts = 0, locked_until = NULL`,
    [user.id, encrypt(secret)]
  );
  const label = encodeURIComponent(`${ISSUER}:${user.email}`);
  const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${ISSUER}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
  const qrCode = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
  return { secret, otpauthUrl, qrCode };
}

/**
 * Check a code for a user and record the outcome. Returns
 * 'ok' | 'invalid' | 'locked' | 'none' (no TOTP set up, or not confirmed when required).
 * A code is accepted only for a later time step than the last one used, so it cannot
 * be reused. Locks are taken row by row so two requests cannot both use one code.
 */
async function verifyCode(userId, code, { confirming = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query('SELECT * FROM totp_credentials WHERE user_id = $1 FOR UPDATE', [userId])).rows[0];
    if (!row || (confirming ? row.confirmed_at : !row.confirmed_at)) {
      await client.query('ROLLBACK');
      return 'none';
    }
    const now = clock.now();
    if (row.locked_until && row.locked_until > now) {
      await client.query('ROLLBACK');
      return 'locked';
    }
    const step = matchingStep(decrypt(row.secret_encrypted), code, now);
    if (step === null || (row.last_used_step !== null && step <= Number(row.last_used_step))) {
      const failed = row.failed_attempts + 1;
      const lock = failed >= MAX_FAILED ? new Date(now.getTime() + LOCK_MINUTES * 60000) : null;
      await client.query(
        'UPDATE totp_credentials SET failed_attempts = $2, locked_until = $3 WHERE user_id = $1',
        [userId, lock ? 0 : failed, lock]
      );
      await client.query('COMMIT');
      return lock ? 'locked' : 'invalid';
    }
    await client.query(
      `UPDATE totp_credentials SET last_used_step = $2, failed_attempts = 0, locked_until = NULL
       ${confirming ? ', confirmed_at = $3' : ''} WHERE user_id = $1`,
      confirming ? [userId, step, now] : [userId, step]
    );
    await client.query('COMMIT');
    return 'ok';
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function removeTotp(userId, client = pool) {
  await client.query('DELETE FROM totp_credentials WHERE user_id = $1', [userId]);
}

module.exports = {
  MAX_FAILED,
  LOCK_MINUTES,
  STEP_SECONDS,
  codeAt,
  currentStep,
  base32Encode,
  base32Decode,
  matchingStep,
  findTotp,
  isTotpEnabled,
  startSetup,
  verifyCode,
  removeTotp,
};
