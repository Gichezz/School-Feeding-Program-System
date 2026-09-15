const express = require('express');
const mealsController = require('../controllers/mealsController');
const { requireJsonBody } = require('../middleware/validate');

const router = express.Router();

router.get('/', mealsController.getMeals);
router.get('/:id', mealsController.getMealById);
router.post('/', requireJsonBody, mealsController.createMeal);

module.exports = router;
