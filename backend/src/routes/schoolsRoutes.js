const express = require('express');
const schoolsController = require('../controllers/schoolsController');

const router = express.Router();

router.get('/', schoolsController.getSchools);
router.get('/:id', schoolsController.getSchoolById);

module.exports = router;
