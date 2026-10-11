const express = require('express');
const router = express.Router();
const { 
  getDashboardSummary, 
  getAttendanceReport, 
  getMealsReport,
  getAttendanceTrend,
  getMealsTrend
} = require('../controllers/reportsController');

/**
 * GET /api/reports/dashboard
 * Get dashboard summary with aggregated metrics
 */
router.get('/dashboard', getDashboardSummary);

/**
 * GET /api/reports/attendance
 * Get attendance report with date range filtering
 */
router.get('/attendance', getAttendanceReport);

/**
 * GET /api/reports/meals
 * Get meal distribution report with date range filtering
 */
router.get('/meals', getMealsReport);

/**
 * GET /api/reports/attendance/trend
 * Get attendance trend data for charts
 */
router.get('/attendance/trend', getAttendanceTrend);

/**
 * GET /api/reports/meals/trend
 * Get meal distribution trend data for charts
 */
router.get('/meals/trend', getMealsTrend);

module.exports = router;
