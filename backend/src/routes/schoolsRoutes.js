const express = require('express');
const schoolsController = require('../controllers/schoolsController');
const { getSchoolFeeding } = require('../controllers/schoolFeedingController');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', schoolsController.getSchools);
router.get('/:id', schoolsController.getSchoolById);

/**
 * GET /api/schools/:id/feeding?termId=
 * One school's term day by day (fed, not fed, not recorded, holidays). For the school's
 * programme officer and its own staff; administrators see no school records
 */
router.get('/:id/feeding', requireRole('programme_officer', 'school_staff'), getSchoolFeeding);

module.exports = router;
