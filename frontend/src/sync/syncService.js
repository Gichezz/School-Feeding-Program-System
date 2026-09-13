/**
 * Synchronization module (Phase 1 placeholder).
 *
 * Later phases will:
 * - enqueue offline operations
 * - push queued operations to the server
 * - compare baseVersion vs server version
 * - surface conflicts for authorized resolution
 *
 * Do not implement sync logic in this phase.
 */

export const SYNC_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  SYNCED: 'synced',
  CONFLICT: 'conflict',
  FAILED: 'failed',
};

export function createSyncQueueItemPlaceholder() {
  return {
    operationId: null,
    entityType: null,
    recordId: null,
    operationType: null,
    payload: null,
    baseVersion: null,
    createdAt: null,
    status: SYNC_STATUS.PENDING,
  };
}
