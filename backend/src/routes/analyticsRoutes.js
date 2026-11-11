const express = require('express');
const router = express.Router();
const { getTermAnalytics } = require('../controllers/analyticsController');
const { requireRole } = require('../middleware/auth');

// Programme records are for programme officers, for their own sub-county. System
// administrators run accounts, devices and configuration, and do not see them (least privilege)
router.use(requireRole('programme_officer'));

/**
 * GET /api/analytics/term?subCounty=&termId=
 * Each school's term so far: days recorded, coverage, food against the ration, stock,
 * deliveries and when it last synced
 */
router.get('/term', getTermAnalytics);

module.exports = router;
