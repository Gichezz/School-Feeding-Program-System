const express = require('express');
const attendanceController = require('../controllers/attendanceController');
const { requireJsonBody } = require('../middleware/validate');

const router = express.Router();

router.get('/', attendanceController.getAttendance);
router.get('/:id', attendanceController.getAttendanceById);
router.post('/', requireJsonBody, attendanceController.createAttendance);

module.exports = router;
