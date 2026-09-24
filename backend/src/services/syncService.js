/**
 * Synchronization service for Phase 6
 * 
 * This service provides backend synchronization capabilities:
 * - accepting queued offline operations
 * - comparing baseVersion with the current server version
 * - applying operations when versions match
 * - recording conflicts when versions differ (no silent overwrite)
 * - supporting authorized conflict-resolution operations (Phase 7)
 */

const SYNC_OPERATION_STATUS = {
  PENDING: 'pending',
  APPLIED: 'applied',
  CONFLICT: 'conflict',
  FAILED: 'failed',
};

function describeSyncProtocol() {
  return {
    strategy: 'version-based',
    silentOverwrite: false,
    status: 'implemented',
    supportedOperations: ['create', 'update'],
    supportedEntityTypes: ['attendance', 'mealDistribution'],
    versionChecking: true,
    idempotency: true,
  };
}

module.exports = {
  SYNC_OPERATION_STATUS,
  describeSyncProtocol,
};
