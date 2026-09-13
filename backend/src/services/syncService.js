/**
 * Synchronization service (Phase 1 placeholder).
 *
 * Later phases will implement:
 * - accepting queued offline operations
 * - comparing baseVersion with the current server version
 * - applying operations when versions match
 * - recording conflicts when versions differ (no silent overwrite)
 * - supporting authorized conflict-resolution operations
 */

const SYNC_OPERATION_STATUS = {
  PENDING: 'pending',
  APPLIED: 'applied',
  CONFLICT: 'conflict',
  REJECTED: 'rejected',
};

function describeSyncProtocol() {
  return {
    strategy: 'version-based',
    silentOverwrite: false,
    status: 'not_implemented_yet',
  };
}

module.exports = {
  SYNC_OPERATION_STATUS,
  describeSyncProtocol,
};
