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
router.post('/', syncOperations);

/**
 * GET /api/sync/changes?schoolId=&since=
 * Download the school's records changed since the device's last download
 */
router.get('/changes', getChanges);

/**
 * GET /api/sync/conflicts
 * Get all conflicts (optionally filtered by client_id and status)
 */
router.get('/conflicts', getConflicts);

/**
 * GET /api/sync/conflicts/:conflictId
 * Get a specific conflict by ID
 */
router.get('/conflicts/:conflictId', getConflictById);

/**
 * POST /api/sync/conflicts/:conflictId/resolve
 * Resolve a conflict by choosing local or server version (administrators, and programme
 * officers for schools in their sub-county)
 */
router.post('/conflicts/:conflictId/resolve', requireRole('admin', 'programme_officer'), resolveConflict);

/**
 * Held records (#61): records a person must apply or discard (administrators, and
 * programme officers for schools in their sub-county)
 */
router.get('/held', requireRole('admin', 'programme_officer'), listHeld);
router.post('/held/:id/apply', requireRole('admin', 'programme_officer'), applyHeld);
router.post('/held/:id/discard', requireRole('admin', 'programme_officer'), discardHeld);

module.exports = router;
