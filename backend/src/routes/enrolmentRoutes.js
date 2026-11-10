const express = require('express');
const router = express.Router();
const { listEnrolment, verifyEnrolment } = require('../controllers/enrolmentController');
const { requireRole } = require('../middleware/auth');

// Enrolment verification: programme officers for their sub-county's schools. System
// administrators can read every sub-county's enrolment but verify nothing
router.use(requireRole('admin', 'programme_officer'));

/**
 * GET /api/enrolment?subCounty=&termId=
 * Each school's enrolment for the term, and whether it is verified
 */
router.get('/', listEnrolment);

/**
 * POST /api/enrolment/:schoolId/:termId/verify
 * Mark the school's enrolment for the term as checked
 */
router.post('/:schoolId/:termId/verify', requireRole('programme_officer'), verifyEnrolment);

module.exports = router;
