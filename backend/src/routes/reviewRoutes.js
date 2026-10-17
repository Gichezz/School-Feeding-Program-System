const express = require('express');
const router = express.Router();
const { listFlags, checkFlag, recordHistory } = require('../controllers/reviewController');
const { requireRole } = require('../middleware/auth');

// Record review is for administrators only (#62)
router.use(requireRole('admin'));

/**
 * GET /api/review/flags?status=open|checked
 * Records flagged as unusual, with who captured them, where and when
 */
router.get('/flags', listFlags);

/**
 * POST /api/review/flags/:id/check
 * Mark a flag as checked, with an optional note
 */
router.post('/flags/:id/check', checkFlag);

/**
 * GET /api/review/records/:entityType/:id/history
 * Every saved version of a record
 */
router.get('/records/:entityType/:id/history', recordHistory);

module.exports = router;
