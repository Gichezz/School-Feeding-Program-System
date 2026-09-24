const express = require('express');
const router = express.Router();
const { syncOperations, resolveConflict, getConflicts, getConflictById } = require('../controllers/syncController');

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
router.post('/conflicts/:conflictId/resolve', resolveConflict);

module.exports = router;
