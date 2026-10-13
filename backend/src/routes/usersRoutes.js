const express = require('express');
const router = express.Router();
const { listUsers, createUser, updateUser, resetPassword, resetPasskeys } = require('../controllers/usersController');
const { requireRole } = require('../middleware/auth');

// Account management is for administrators only
router.use(requireRole('admin'));

/**
 * GET /api/users
 * All accounts (never includes passwords)
 */
router.get('/', listUsers);

/**
 * POST /api/users
 * Add a user with a name, email, role and initial password
 */
router.post('/', createUser);

/**
 * PATCH /api/users/:id
 * Change a user's name or role, or deactivate / reactivate them
 */
router.patch('/:id', updateUser);

/**
 * POST /api/users/:id/password
 * Reset a user's password; their existing sessions end
 */
router.post('/:id/password', resetPassword);

/**
 * POST /api/users/:id/passkeys/reset
 * Remove another administrator's passkeys and recovery codes (lost device); their
 * sessions end and they add a new passkey after signing in with their password
 */
router.post('/:id/passkeys/reset', resetPasskeys);

module.exports = router;
