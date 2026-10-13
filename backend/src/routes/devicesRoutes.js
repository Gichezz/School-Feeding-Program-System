const express = require('express');
const router = express.Router();
const {
  challenge,
  enrol,
  signIn,
  listDevices,
  approveDevice,
  revokeDevice,
  unlockDeviceUser,
} = require('../controllers/deviceController');
const { requireAuth, requireRole } = require('../middleware/auth');

/**
 * POST /api/devices/challenge
 * A one-time challenge for the device to sign (public)
 */
router.post('/challenge', challenge);

/**
 * POST /api/devices/enrol
 * Set up staff sign-in on this device: activation code or password, a PIN, and the
 * device's signature (public)
 */
router.post('/enrol', enrol);

/**
 * POST /api/devices/sign-in
 * Staff sign-in: email + PIN + the device's signature (public)
 */
router.post('/sign-in', signIn);

// Managing devices is for administrators only
const adminOnly = [requireAuth, requireRole('admin')];

/**
 * GET /api/devices
 * Every school device, its status and the staff enrolled on it
 */
router.get('/', adminOnly, listDevices);

/**
 * POST /api/devices/:id/approve and /revoke
 */
router.post('/:id/approve', adminOnly, approveDevice);
router.post('/:id/revoke', adminOnly, revokeDevice);

/**
 * POST /api/devices/:id/users/:userId/unlock
 * Clear a lock after too many wrong PINs
 */
router.post('/:id/users/:userId/unlock', adminOnly, unlockDeviceUser);

module.exports = router;
