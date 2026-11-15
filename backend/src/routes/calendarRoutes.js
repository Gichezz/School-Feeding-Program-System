const express = require('express');
const {
  listTerms, createTerm, updateTerm, deleteTerm, listEvents, createEvent, updateEvent, deleteEvent,
} = require('../controllers/calendarController');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const adminOnly = requireRole('admin');
// Administrators keep the national dates; programme officers their sub-county's school dates
const calendarKeepers = requireRole('admin', 'programme_officer');

/**
 * Terms (administrators). Dates are DD-MM-YYYY.
 * GET    /api/calendar/terms
 * POST   /api/calendar/terms        { year, term, opensOn, closesOn, halfTermStart?, halfTermEnd? }
 * PATCH  /api/calendar/terms/:id    any of the same
 * DELETE /api/calendar/terms/:id    refused once schools have enrolment for the term
 */
router.get('/terms', adminOnly, listTerms);
router.post('/terms', adminOnly, createTerm);
router.patch('/terms/:id', adminOnly, updateTerm);
router.delete('/terms/:id', adminOnly, deleteTerm);

/**
 * Calendar dates. Administrators: public holidays and national exams. Programme officers:
 * school closures and events for schools in their sub-county.
 * GET    /api/calendar/events?year=
 * POST   /api/calendar/events       { kind, name, startsOn, endsOn?, schoolId? }
 * PATCH  /api/calendar/events/:id   any of the same
 * DELETE /api/calendar/events/:id
 */
router.get('/events', calendarKeepers, listEvents);
router.post('/events', calendarKeepers, createEvent);
router.patch('/events/:id', calendarKeepers, updateEvent);
router.delete('/events/:id', calendarKeepers, deleteEvent);

module.exports = router;
