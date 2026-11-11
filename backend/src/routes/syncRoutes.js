const express = require('express');
const router = express.Router();
const { syncOperations, resolveConflict, getConflicts, getConflictById } = require('../controllers/syncController');
const { listHeld, applyHeld, discardHeld } = require('../controllers/heldController');
const { getChanges } = require('../controllers/changesController');
const { requireRole } = require('../middleware/auth');

/**
 * POST /api/sync
 * Process synchronization operations from frontend
 */
// Only a school's devices send records. Feeding teachers read their school's records and
// conflicts, programme officers their sub-county's; system administrators see none
const schoolDevice = requireRole('school_staff');
const notAdmin = requireRole('school_staff', 'programme_officer');
router.post('/', schoolDevice, syncOperations);

/**
 * GET /api/sync/changes?schoolId=&since=
 * Download the school's records changed since the device's last download
 */
router.get('/changes', notAdmin, getChanges);

/**
 * GET /api/sync/conflicts
 * Get all conflicts (optionally filtered by client_id and status)
 */
router.get('/conflicts', notAdmin, getConflicts);

/**
 * GET /api/sync/conflicts/:conflictId
 * Get a specific conflict by ID
 */
router.get('/conflicts/:conflictId', notAdmin, getConflictById);

/**
 * POST /api/sync/conflicts/:conflictId/resolve
 * Resolve a conflict by choosing local or server version (programme officers, for schools
 * in their sub-county)
 */
router.post('/conflicts/:conflictId/resolve', requireRole('programme_officer'), resolveConflict);

/**
 * Held records (#61): records a programme officer applies or discards, for schools in
 * their sub-county
 */
router.get('/held', requireRole('programme_officer'), listHeld);
router.post('/held/:id/apply', requireRole('programme_officer'), applyHeld);
router.post('/held/:id/discard', requireRole('programme_officer'), discardHeld);

module.exports = router;
