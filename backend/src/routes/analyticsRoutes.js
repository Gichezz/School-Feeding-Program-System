const express = require('express');
const router = express.Router();
const { getTermAnalytics } = require('../controllers/analyticsController');
const { requireRole } = require('../middleware/auth');

// Sub-county analytics are for programme officers (their own sub-county) and administrators
router.use(requireRole('admin', 'programme_officer'));

/**
 * GET /api/analytics/term?subCounty=&termId=
 * Each school's term so far: days recorded, coverage, food against the ration, stock,
 * deliveries and when it last synced
 */
router.get('/term', getTermAnalytics);

module.exports = router;
