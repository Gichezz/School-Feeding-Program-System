const express = require('express');
const router = express.Router();
const { listFlags, checkFlag, recordHistory } = require('../controllers/reviewController');
const { requireRole } = require('../middleware/auth');

// Record review: programme officers for their sub-county's schools (#62). System
// administrators can read every flag and history but decide nothing
router.use(requireRole('admin', 'programme_officer'));
const officerOnly = requireRole('programme_officer');

/**
 * GET /api/review/flags?status=open|checked
 * Records flagged as unusual, with who captured them, where and when
 */
router.get('/flags', listFlags);

/**
 * POST /api/review/flags/:id/check
 * Mark a flag as checked, with an optional note
 */
router.post('/flags/:id/check', officerOnly, checkFlag);

/**
 * GET /api/review/records/:entityType/:id/history
 * Every saved version of a record
 */
router.get('/records/:entityType/:id/history', recordHistory);

module.exports = router;
