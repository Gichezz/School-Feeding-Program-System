const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const { sessionFor } = require('../services/userAccounts');
const passkeys = require('../services/passkeys');
const totp = require('../services/totp');

/**
 * Authenticator app codes (TOTP) for administrators (#63): a second option beside
 * passkeys (#57) for an administrator whose computer or phone cannot hold a passkey.
 * Password + a code from the app signs in; the recovery codes work for either.
 */

const SIGN_IN_FAILED = 'Those details could not be used to sign in';
const CODE_WRONG = 'That code is not right, or it was already used. Wait for the next code in your authenticator app and try again.';
const LOCKED = `Too many wrong codes. Code sign-in is paused for ${totp.LOCK_MINUTES} minutes; you can still use a passkey or a recovery code.`;

/**
 * GET /api/auth/totp → { enabled, confirmedAt }
 */
async function getTotpStatus(req, res, next) {
  try {
    const row = await totp.findTotp(req.user.id);
    res.json({ enabled: Boolean(row?.confirmed_at), confirmedAt: row?.confirmed_at || null });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/totp/setup → { secret, otpauthUrl, qrCode }
 * A new secret to add to the authenticator app (scan the QR code, or type the secret).
 * It only takes effect once a code from the app is confirmed.
 */
async function setupTotp(req, res, next) {
  try {
    const setup = await totp.startSetup(req.user);
    if (!setup) return res.status(409).json({ error: 'An authenticator app is already set up. Remove it first to set up another.' });
    res.json(setup);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/totp/confirm  Body: { code } → { enabled, recoveryCodes? }
 * Turns TOTP on once the app shows the right code. An administrator without a passkey
 * gets recovery codes here, once, as they would with their first passkey.
 */
async function confirmTotp(req, res, next) {
  try {
    const outcome = await totp.verifyCode(req.user.id, req.body?.code, { confirming: true });
    if (outcome === 'none') return res.status(400).json({ error: 'Start the set-up again; there is no authenticator app waiting to be confirmed.' });
    if (outcome === 'locked') return res.status(429).json({ error: LOCKED });
    if (outcome !== 'ok') return res.status(400).json({ error: 'That code is not right. Check the app shows Lishe and enter the current code.' });

    const needsRecoveryCodes = (await passkeys.countPasskeys(req.user.id)) === 0;
    const recoveryCodes = needsRecoveryCodes ? await passkeys.replaceRecoveryCodes(req.user.id) : undefined;
    res.json({ enabled: true, ...(recoveryCodes && { recoveryCodes }) });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/auth/totp
 * An administrator keeps a second way to sign in: removing the app needs a passkey.
 */
async function removeTotp(req, res, next) {
  try {
    const row = await totp.findTotp(req.user.id);
    if (!row) return res.status(404).json({ error: 'No authenticator app is set up' });
    if (row.confirmed_at && (await passkeys.countPasskeys(req.user.id)) === 0) {
      return res.status(400).json({ error: 'Add a passkey before removing your authenticator app, so you can still sign in securely.' });
    }
    await totp.removeTotp(req.user.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/totp/login  Body: { email, password, code } → { token, expiresAt, user } (public)
 * The password is checked first; only then is the code checked, so wrong passwords
 * cannot lock an administrator out of code sign-in.
 */
async function signInWithTotp(req, res, next) {
  try {
    const { email, password, code } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || typeof code !== 'string' || !email.trim() || !password || !code.trim()) {
      return res.status(400).json({ error: 'Email, password and a code are required' });
    }
    const result = await pool.query(
      'SELECT id, name, email, role, school_id, is_active, password_hash FROM users WHERE lower(email) = lower($1)',
      [email.trim()]
    );
    const user = result.rows[0];
    const passwordMatches = user && (await bcrypt.compare(password, user.password_hash));
    if (!passwordMatches || !user.is_active || user.role !== 'admin') {
      return res.status(401).json({ error: SIGN_IN_FAILED });
    }

    const outcome = await totp.verifyCode(user.id, code);
    if (outcome === 'none') return res.status(401).json({ error: SIGN_IN_FAILED });
    if (outcome === 'locked') return res.status(429).json({ error: LOCKED });
    if (outcome !== 'ok') return res.status(401).json({ error: CODE_WRONG });
    res.json(await sessionFor(user));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getTotpStatus,
  setupTotp,
  confirmTotp,
  removeTotp,
  signInWithTotp,
};
