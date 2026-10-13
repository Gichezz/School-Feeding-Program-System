const express = require('express');
const router = express.Router();
const { syncOperations, resolveConflict, getConflicts, getConflictById } = require('../controllers/syncController');
const { listHeld, applyHeld, discardHeld } = require('../controllers/heldController');
const { requireRole } = require('../middleware/auth');

/**
 * POST /api/sync
 * Process synchronization operations from frontend
 */
router.post('/', syncOperations);

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
 * Resolve a conflict by choosing local or server version
 */
router.post('/conflicts/:conflictId/resolve', requireRole('admin'), resolveConflict);

/**
 * Held records (#61): records an administrator must apply or discard
 */
router.get('/held', requireRole('admin'), listHeld);
router.post('/held/:id/apply', requireRole('admin'), applyHeld);
router.post('/held/:id/discard', requireRole('admin'), discardHeld);

module.exports = router;
