const express = require('express');
const router = express.Router();
const { getForecast } = require('../controllers/forecastController');

/**
 * GET /api/forecasts?school_id=&start_date=DD-MM-YYYY&horizon_days=&enrollment=
 * Meal-demand forecast for a school (proxied to the Flask forecasting service)
 */
router.get('/', getForecast);

module.exports = router;
