const express = require('express');
const router = express.Router();
const { login, me, changePassword } = require('../controllers/authController');
const {
  listPasskeys,
  registrationOptions,
  registerPasskey,
  removePasskey,
  regenerateRecoveryCodes,
  signInOptions,
  signInWithPasskey,
  signInWithRecoveryCode,
} = require('../controllers/passkeyController');
const { requireAuth, requireRole } = require('../middleware/auth');

/**
 * POST /api/auth/login
 * Exchange email and password for a session token (public)
 */
router.post('/login', login);

/**
 * GET /api/auth/me
 * The signed-in user
 */
router.get('/me', requireAuth, me);

/**
 * PUT /api/auth/password
 * Change your own password (current password required); other sessions end
 */
router.put('/password', requireAuth, changePassword);

/**
 * Passkey sign-in (public): get a challenge, then send the device's signed response
 */
router.post('/passkeys/login/options', signInOptions);
router.post('/passkeys/login/verify', signInWithPasskey);

/**
 * POST /api/auth/recovery
 * Password + one recovery code, for an administrator who cannot use their passkeys (public)
 */
router.post('/recovery', signInWithRecoveryCode);

/**
 * Managing your own passkeys and recovery codes (administrators)
 */
const adminOnly = [requireAuth, requireRole('admin')];
router.get('/passkeys', adminOnly, listPasskeys);
router.post('/passkeys/register/options', adminOnly, registrationOptions);
router.post('/passkeys/register/verify', adminOnly, registerPasskey);
router.delete('/passkeys/:id', adminOnly, removePasskey);
router.post('/recovery-codes', adminOnly, regenerateRecoveryCodes);

module.exports = router;
