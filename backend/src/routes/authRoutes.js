const express = require('express');
const router = express.Router();
const { login, me } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

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

module.exports = router;
