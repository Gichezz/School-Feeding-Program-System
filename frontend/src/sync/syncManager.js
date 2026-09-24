import { isOnline, processSingleOperation } from './syncService';
import {
  getPendingOperations,
  markOperationSynced,
  markOperationFailed,
  markOperationConflict,
  incrementRetryCount,
  getSyncQueueStats
} from './syncQueue';
import { updateLocalAttendance, updateLocalMeal } from '../services/localDb';

/**
 * Sync Manager - Phase 6
 * Handles automatic synchronization of queued operations
 */

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

let isSyncing = false;
let syncProgress = {
  total: 0,
  processed: 0,
  successful: 0,
  failed: 0,
  conflicts: 0
};

/**
 * Get current sync progress
 */
export function getSyncProgress() {
  return { ...syncProgress };
}

/**
 * Check if synchronization is currently in progress
 */
export function isSyncInProgress() {
  return isSyncing;
}

/**
 * Process the sync queue
 */
export async function processSyncQueue() {
  console.log('processSyncQueue called, isSyncing:', isSyncing, 'isOnline:', isOnline());
  
  if (isSyncing) {
    console.log('Sync already in progress');
    return {
      success: false,
      message: 'Sync already in progress'
    };
  }

  if (!isOnline()) {
    console.log('Cannot sync while offline');
    return {
      success: false,
      message: 'Cannot sync while offline'
    };
  }

  try {
    isSyncing = true;
    
    // Reset progress
    syncProgress = {
      total: 0,
      processed: 0,
      successful: 0,
      failed: 0,
      conflicts: 0
    };

    console.log('Getting pending operations...');
    const pendingOperations = await getPendingOperations();
    console.log('Pending operations:', pendingOperations);
    syncProgress.total = pendingOperations.length;

    if (pendingOperations.length === 0) {
      console.log('No pending operations to sync');
      return {
        success: true,
        message: 'No pending operations to sync',
        progress: syncProgress
      };
    }

    console.log(`Processing ${pendingOperations.length} pending operations`);

    // Process operations in order
    for (const operation of pendingOperations) {
      console.log(`Processing operation:`, operation);
      try {
        const result = await processSingleOperation(operation);
        console.log(`Operation result:`, result);
        syncProgress.processed++;

        if (result.success) {
          // Update local record with server version
          await updateLocalRecordAfterSync(operation, result);
          
          // Mark operation as synced
          await markOperationSynced(operation.id);
          syncProgress.successful++;
          
          console.log(`Operation ${operation.id} synced successfully`);
        } else if (result.status === 'conflict') {
          // Mark operation as conflict
          await markOperationConflict(operation.id, result.conflictData);
          
          // Update local record sync status
          await updateLocalRecordConflictStatus(operation, result.conflictData);
          
          syncProgress.conflicts++;
          console.log(`Operation ${operation.id} has conflict`);
        } else {
          // Handle failure with retry logic
          const currentRetryCount = operation.retryCount || 0;
          
          if (currentRetryCount < MAX_RETRIES) {
            await incrementRetryCount(operation.id, result.error);
            console.log(`Operation ${operation.id} failed, retry ${currentRetryCount + 1}/${MAX_RETRIES}`);
          } else {
            await markOperationFailed(operation.id, result.error);
            syncProgress.failed++;
            console.log(`Operation ${operation.id} failed after ${MAX_RETRIES} retries`);
          }
        }
      } catch (error) {
        console.error(`Error processing operation ${operation.id}:`, error);
        
        const currentRetryCount = operation.retryCount || 0;
        
        if (currentRetryCount < MAX_RETRIES) {
          await incrementRetryCount(operation.id, error.message);
        } else {
          await markOperationFailed(operation.id, error.message);
          syncProgress.failed++;
        }
        
        syncProgress.processed++;
      }
    }

    return {
      success: true,
      message: 'Sync completed',
      progress: syncProgress
    };
  } catch (error) {
    console.error('Error processing sync queue:', error);
    return {
      success: false,
      message: error.message,
      progress: syncProgress
    };
  } finally {
    isSyncing = false;
    console.log('Sync process completed, isSyncing set to false');
  }
}

/**
 * Update local record after successful sync
 */
async function updateLocalRecordAfterSync(operation, syncResult) {
  try {
    if (operation.entityType === 'attendance') {
      await updateLocalAttendance(operation.recordId, {
        syncStatus: 'synced',
        version: syncResult.version
      });
    } else if (operation.entityType === 'mealDistribution') {
      await updateLocalMeal(operation.recordId, {
        syncStatus: 'synced',
        version: syncResult.version
      });
    }
  } catch (error) {
    console.error('Error updating local record after sync:', error);
  }
}

/**
 * Update local record conflict status
 */
async function updateLocalRecordConflictStatus(operation, conflictData) {
  try {
    if (operation.entityType === 'attendance') {
      await updateLocalAttendance(operation.recordId, {
        syncStatus: 'conflict',
        conflictData
      });
    } else if (operation.entityType === 'mealDistribution') {
      await updateLocalMeal(operation.recordId, {
        syncStatus: 'conflict',
        conflictData
      });
    }
  } catch (error) {
    console.error('Error updating local record conflict status:', error);
  }
}

/**
 * Manual sync trigger
 */
export async function manualSync() {
  console.log('Manual sync triggered');
  return await processSyncQueue();
}

/**
 * Get comprehensive sync status
 */
export async function getComprehensiveSyncStatus() {
  try {
    const stats = await getSyncQueueStats();
    const online = isOnline();
    
    return {
      online,
      syncing: isSyncing,
      progress: syncProgress,
      queueStats: stats,
      lastSyncAttempt: null, // Could be stored in metadata
      lastSuccessfulSync: null // Could be stored in metadata
    };
  } catch (error) {
    console.error('Error getting comprehensive sync status:', error);
    return {
      online: isOnline(),
      syncing: isSyncing,
      error: error.message
    };
  }
}

/**
 * Setup automatic sync when connectivity returns
 */
export function setupAutoSync() {
  const handleOnline = async () => {
    console.log('Connection restored, triggering automatic sync');
    // Small delay to ensure connection is stable
    setTimeout(async () => {
      try {
        await processSyncQueue();
        // Dispatch event to notify UI that sync completed
        window.dispatchEvent(new CustomEvent('syncCompleted'));
      } catch (error) {
        console.error('Auto sync failed:', error);
      }
    }, 1000);
  };

  window.addEventListener('online', handleOnline);

  // Return cleanup function
  return () => {
    window.removeEventListener('online', handleOnline);
  };
}
