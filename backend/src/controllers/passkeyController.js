const bcrypt = require('bcryptjs');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { pool } = require('../db/pool');
const { getWebAuthnConfig } = require('../config/webauthn');
const { sessionFor } = require('../services/userAccounts');
const passkeys = require('../services/passkeys');

/**
 * Passkey (WebAuthn) sign-in for administrators (#57). The browser creates a key pair
 * on the device; only the public key reaches the server. Every registration and sign-in
 * is verified here against a one-time challenge, the expected origin and the RP ID.
 */

const PASSKEY_FAILED = 'The passkey could not be verified. Try again.';
const RECOVERY_FAILED = 'Those details could not be used to sign in';
const MAX_NAME_LENGTH = 60;

function isResponse(value) {
  return value && typeof value === 'object' && typeof value.id === 'string' && value.response && typeof value.response === 'object';
}

/**
 * GET /api/auth/passkeys → { passkeys, recoveryCodesLeft }
 */
async function listPasskeys(req, res, next) {
  try {
    res.json({
      passkeys: await passkeys.listPasskeys(req.user.id),
      recoveryCodesLeft: await passkeys.countRecoveryCodes(req.user.id),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/passkeys/register/options → WebAuthn creation options
 */
async function registrationOptions(req, res, next) {
  try {
    const { rpID, rpName } = getWebAuthnConfig();
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: req.user.email,
      userDisplayName: req.user.name,
      userID: new TextEncoder().encode(req.user.id),
      attestationType: 'none',
      excludeCredentials: await passkeys.credentialDescriptors(req.user.id),
      // A discoverable passkey that needs the device's fingerprint, face or PIN to use
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    await passkeys.saveChallenge(options.challenge, 'register', req.user.id);
    res.json(options);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/passkeys/register/verify
 * Body: { response, name } → 201 { passkey, recoveryCodes? }
 * Recovery codes are returned once, with the account's first passkey.
 */
async function registerPasskey(req, res, next) {
  try {
    const { response, name } = req.body || {};
    if (!isResponse(response)) return res.status(400).json({ error: 'A passkey response is required' });

    const challenge = passkeys.challengeFromResponse(response);
    if (!(await passkeys.consumeChallenge(challenge, 'register', req.user.id))) {
      return res.status(400).json({ error: 'This passkey request has expired. Start again.' });
    }

    const { rpID, origins } = getWebAuthnConfig();
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch {
      return res.status(400).json({ error: PASSKEY_FAILED });
    }
    if (!verification.verified) return res.status(400).json({ error: PASSKEY_FAILED });

    const { credential } = verification.registrationInfo;
    const label = typeof name === 'string' && name.trim() ? name.trim().slice(0, MAX_NAME_LENGTH) : 'Passkey';
    const isFirst = (await passkeys.countPasskeys(req.user.id)) === 0;

    const inserted = await pool.query(
      `INSERT INTO passkey_credentials (user_id, credential_id, public_key, counter, transports, name)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (credential_id) DO NOTHING
       RETURNING id, name, created_at, last_used_at`,
      [req.user.id, credential.id, Buffer.from(credential.publicKey), credential.counter, credential.transports || [], label]
    );
    if (inserted.rows.length === 0) {
      return res.status(409).json({ error: 'This passkey is already registered' });
    }

    const recoveryCodes = isFirst ? await passkeys.replaceRecoveryCodes(req.user.id) : undefined;
    const row = inserted.rows[0];
    res.status(201).json({
      passkey: { id: row.id, name: row.name, createdAt: row.created_at, lastUsedAt: row.last_used_at },
      ...(recoveryCodes && { recoveryCodes }),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/auth/passkeys/:id
 * An administrator keeps at least one passkey; to start again, another administrator
 * resets their passkeys.
 */
async function removePasskey(req, res, next) {
  try {
    const owned = await pool.query('SELECT id FROM passkey_credentials WHERE id::text = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (owned.rows.length === 0) return res.status(404).json({ error: 'Passkey not found' });
    if ((await passkeys.countPasskeys(req.user.id)) <= 1) {
      return res.status(400).json({ error: 'You need at least one passkey. Add another one before removing this one.' });
    }
    await pool.query('DELETE FROM passkey_credentials WHERE id = $1', [owned.rows[0].id]);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/recovery-codes → { recoveryCodes }
 * A new set of recovery codes; the old ones stop working.
 */
async function regenerateRecoveryCodes(req, res, next) {
  try {
    if ((await passkeys.countPasskeys(req.user.id)) === 0) {
      return res.status(400).json({ error: 'Add a passkey first; recovery codes come with it' });
    }
    res.json({ recoveryCodes: await passkeys.replaceRecoveryCodes(req.user.id) });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/passkeys/login/options → WebAuthn request options (public)
 * No email is needed: the device offers the passkeys it holds for Lishe.
 */
async function signInOptions(req, res, next) {
  try {
    const { rpID } = getWebAuthnConfig();
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
    await passkeys.saveChallenge(options.challenge, 'authenticate');
    res.json(options);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/passkeys/login/verify
 * Body: { response } → { token, expiresAt, user } (public)
 */
async function signInWithPasskey(req, res, next) {
  try {
    const { response } = req.body || {};
    if (!isResponse(response)) return res.status(400).json({ error: 'A passkey response is required' });

    const challenge = passkeys.challengeFromResponse(response);
    if (!(await passkeys.consumeChallenge(challenge, 'authenticate'))) {
      return res.status(401).json({ error: 'This sign-in request has expired. Try again.' });
    }

    const stored = await passkeys.findCredential(response.id);
    if (!stored || !stored.is_active) return res.status(401).json({ error: PASSKEY_FAILED });

    const { rpID, origins } = getWebAuthnConfig();
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: stored.credential_id,
          publicKey: new Uint8Array(stored.public_key),
          counter: Number(stored.counter),
          transports: stored.transports,
        },
      });
    } catch {
      return res.status(401).json({ error: PASSKEY_FAILED });
    }
    if (!verification.verified) return res.status(401).json({ error: PASSKEY_FAILED });

    await pool.query(
      'UPDATE passkey_credentials SET counter = $1, last_used_at = NOW() WHERE id = $2',
      [verification.authenticationInfo.newCounter, stored.id]
    );
    res.json(await sessionFor({ id: stored.user_id, name: stored.name, email: stored.email, role: stored.role }));
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/recovery
 * Body: { email, password, code } → { token, expiresAt, user } (public)
 * For an administrator who has lost access to their passkeys: password + one recovery code.
 */
async function signInWithRecoveryCode(req, res, next) {
  try {
    const { email, password, code } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || typeof code !== 'string' || !email.trim() || !password || !code.trim()) {
      return res.status(400).json({ error: 'Email, password and a recovery code are required' });
    }
    const result = await pool.query(
      'SELECT id, name, email, role, is_active, password_hash FROM users WHERE lower(email) = lower($1)',
      [email.trim()]
    );
    const user = result.rows[0];
    const passwordMatches = user && (await bcrypt.compare(password, user.password_hash));
    if (!passwordMatches || !user.is_active || !(await passkeys.useRecoveryCode(user.id, code))) {
      return res.status(401).json({ error: RECOVERY_FAILED });
    }
    const session = await sessionFor(user);
    res.json({ ...session, recoveryCodesLeft: await passkeys.countRecoveryCodes(user.id) });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listPasskeys,
  registrationOptions,
  registerPasskey,
  removePasskey,
  regenerateRecoveryCodes,
  signInOptions,
  signInWithPasskey,
  signInWithRecoveryCode,
};
