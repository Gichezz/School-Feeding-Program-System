const express = require('express');
const attendanceController = require('../controllers/attendanceController');
const { requireJsonBody } = require('../middleware/validate');
const { requireRole } = require('../middleware/auth');
const { scopeToSchool } = require('../middleware/scope');

const router = express.Router();

// Schools send records; officers read their sub-county's. System administrators do not
// see or write school records (least privilege)
router.get('/', scopeToSchool, attendanceController.getAttendance);
router.get('/:id', requireRole('school_staff', 'programme_officer'), attendanceController.getAttendanceById);
router.post('/', requireRole('school_staff'), requireJsonBody, attendanceController.createAttendance);

module.exports = router;
