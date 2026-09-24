const express = require('express');
const router = express.Router();
const { syncOperations } = require('../controllers/syncController');

/**
 * POST /api/sync
 * Process synchronization operations from frontend
 */
router.post('/', syncOperations);

module.exports = router;
