const express = require('express');
const router = express.Router();
const { listRuns, getRun, runWeek, decide } = require('../controllers/reviewListController');
const { requireRole } = require('../middleware/auth');

// Weekly review lists are for programme officers (their own sub-county) and administrators
router.use(requireRole('admin', 'programme_officer'));

/**
 * GET /api/review-lists?subCounty=
 * Scored weeks for the sub-county, newest first
 */
router.get('/', listRuns);

/**
 * GET /api/review-lists/:week?subCounty=   (week = the Monday, DD-MM-YYYY)
 * One week's ranking with reasons and decisions
 */
router.get('/:week', getRun);

/**
 * POST /api/review-lists/:week/run
 * Score the week with the review scoring service
 */
router.post('/:week/run', runWeek);

/**
 * PUT /api/review-lists/:week/decisions/:schoolId
 * Mark a school's week explained or follow-up, with a note
 */
// The officer's decision; system administrators only read lists
router.put('/:week/decisions/:schoolId', requireRole('programme_officer'), decide);

module.exports = router;
