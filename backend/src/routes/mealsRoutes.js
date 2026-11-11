const express = require('express');
const mealsController = require('../controllers/mealsController');
const { requireJsonBody } = require('../middleware/validate');
const { requireRole } = require('../middleware/auth');
const { scopeToSchool } = require('../middleware/scope');

const router = express.Router();

// Schools send records; officers read their sub-county's. System administrators do not
// see or write school records (least privilege)
router.get('/', scopeToSchool, mealsController.getMeals);
router.get('/:id', requireRole('school_staff', 'programme_officer'), mealsController.getMealById);
router.post('/', requireRole('school_staff'), requireJsonBody, mealsController.createMeal);

module.exports = router;
