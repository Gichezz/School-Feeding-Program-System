const express = require('express');
const router = express.Router();
const { listEnrolment, verifyEnrolment, recordDiscrepancy } = require('../controllers/enrolmentController');
const { requireRole } = require('../middleware/auth');

// Programme records are for programme officers, for their own sub-county. System
// administrators run accounts, devices and configuration, and do not see them (least privilege)
router.use(requireRole('programme_officer'));

/**
 * GET /api/enrolment?subCounty=&termId=
 * Each school's enrolment for the term, and whether it is verified
 */
router.get('/', listEnrolment);

/**
 * POST /api/enrolment/:schoolId/:termId/verify
 * Mark the school's enrolment for the term as checked
 */
router.post('/:schoolId/:termId/verify', verifyEnrolment);

/**
 * POST /api/enrolment/:schoolId/:termId/discrepancy
 * Record that the school's enrolment does not match the register, with a note the school sees
 */
router.post('/:schoolId/:termId/discrepancy', recordDiscrepancy);

module.exports = router;
