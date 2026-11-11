import { isOnline, processSingleOperation } from './syncService';
import {
  markOperationHeld,
  getPendingOperations,
  markOperationSynced,
  markOperationFailed,
  markOperationConflict,
  incrementRetryCount,
  noteConnectionProblem,
  requeueConnectionFailures,
  getSyncQueueStats
} from './syncQueue';
import { updateLocalAttendance, updateLocalMeal, setLocalSyncStatus } from '../services/localDb';
import { saveConflict } from './conflictService';
import { forgetOfflineUser } from '../features/devices/offlineSignIn';
import { hasRole, isSessionValid } from '../services/session';
import db from '../db/database';
import { getDeviceIdentity } from '../features/devices/deviceIdentity';
import { pullChanges } from './pullChanges';

/**
 * Sync Manager - Phase 6
 * Handles automatic synchronization of queued operations
 */

const MAX_RETRIES = 3;
const AUTO_SYNC_DELAY_MS = 5000; // after reconnecting or opening the app, let the connection settle
// While online, records still waiting are retried automatically (#74): soon after a sync that
// got some through, then less often while nothing gets through
const RETRY_DELAYS_MS = [5000, 15000, 30000, 60000, 120000, 300000];
// A pass stops after this many dropped connections in a row; the retry schedule takes over
const MAX_CONNECTION_PROBLEMS_PER_PASS = 3;
// Gateway errors while the server restarts are connection problems, not answers about the record
const GATEWAY_ERRORS = new Set([502, 503, 504]);
const SIGN_IN_TO_SYNC = 'Sign in again to sync. Your records are saved on this device.';
const TEACHER_SYNCS = 'Records on this device sync when a feeding teacher signs in.';

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
 * A request that never reached the server or got no answer from it (#74). It says nothing
 * about the record, so it does not count towards the retry limit.
 */
function isConnectionProblem(result) {
  return result.status === 'failed' && (result.httpStatus === undefined || GATEWAY_ERRORS.has(result.httpStatus));
}

// Automatic retries are only scheduled once the app has set up automatic sync
let autoRetry = false;
let retryTimer = null;
let retryStep = 0;
let lastPass = null;

function clearRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

function syncLater(delay) {
  clearRetry();
  retryTimer = setTimeout(() => {
    retryTimer = null;
    processSyncQueue().catch(() => {});
  }, delay);
}

/**
 * After a sync pass: if records are still waiting while online, try again on the retry
 * schedule; once nothing is waiting, the schedule starts again from the beginning.
 */
function planNextSync(pass) {
  if (!autoRetry || !pass) return;
  if (pass.waiting === 0 || !isOnline() || !isSessionValid()) {
    clearRetry();
    retryStep = 0;
    return;
  }
  retryStep = pass.madeProgress ? 0 : Math.min(retryStep + 1, RETRY_DELAYS_MS.length - 1);
  syncLater(RETRY_DELAYS_MS[retryStep]);
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
      message: 'Already syncing.'
    };
  }

  if (!isOnline()) {
    console.log('Cannot sync while offline');
    return {
      success: false,
      message: 'You are offline. Your records will sync when you are back online.'
    };
  }

  // Queued records stay on the device until someone signs in; this is not a failed attempt
  if (!isSessionValid()) {
    return {
      success: false,
      authRequired: true,
      message: SIGN_IN_TO_SYNC
    };
  }

  // Only a school's feeding teachers send and download its records; an officer or
  // administrator signed in on a school device leaves them for the teacher (the server
  // refuses them too)
  if (!hasRole('school_staff')) {
    return { success: false, notTeacher: true, message: TEACHER_SYNCS };
  }

  try {
    isSyncing = true;
    lastPass = null;
    
    // Reset progress
    syncProgress = {
      total: 0,
      processed: 0,
      successful: 0,
      failed: 0,
      conflicts: 0
    };

    // Download the school's changes first, so edits are made on the latest copy
    const schoolId = await deviceSchoolId();
    await download(schoolId);

    console.log('Getting pending operations...');
    const pendingOperations = await getPendingOperations();
    console.log('Pending operations:', pendingOperations);
    syncProgress.total = pendingOperations.length;

    if (pendingOperations.length === 0) {
      console.log('No pending operations to sync');
      return {
        success: true,
        message: 'Nothing waiting to sync.',
        progress: syncProgress
      };
    }

    // The records sent in this pass share one sync batch on the server
    const syncBatchId = crypto.randomUUID();

    console.log(`Processing ${pendingOperations.length} pending operations`);

    // Process operations in order. A record's later changes wait while an earlier change
    // to it is in conflict, still waiting or has failed: they were made on top of it, and
    // sending them could overwrite another device's record with the same version number.
    const deferredIds = new Set();
    const blockedRecords = await recordsWithUnfinishedChanges();
    const blockedIds = new Set();
    let connectionProblems = 0;
    for (const operation of pendingOperations) {
      const key = recordKey(operation);
      if (blockedRecords.has(key)) {
        blockedIds.add(operation.id);
        syncProgress.blocked = (syncProgress.blocked || 0) + 1;
        continue;
      }
      console.log(`Processing operation:`, operation);
      try {
        const result = await processSingleOperation(await withBaseRecord(operation), { syncBatchId });
        if (!result.success) blockedRecords.add(key);
        console.log(`Operation result:`, result);
        syncProgress.processed++;

        if (isConnectionProblem(result)) {
          // Stays pending without using up a retry; stop for now if the connection seems down
          await noteConnectionProblem(operation.id, result.error);
          syncProgress.waiting = (syncProgress.waiting || 0) + 1;
          connectionProblems++;
          if (connectionProblems >= MAX_CONNECTION_PROBLEMS_PER_PASS) break;
          continue;
        }
        connectionProblems = 0;

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
          
          // Save conflict to local database (details come from the server's sync result)
          const conflictData = result.conflictData || {};
          await saveConflict({
            operationId: operation.id,
            entityType: operation.entityType,
            recordId: operation.recordId,
            baseVersion: conflictData.baseVersion,
            serverVersion: conflictData.serverVersion,
            localPayload: conflictData.localPayload,
            serverRecord: conflictData.serverRecord,
            conflictId: conflictData.conflictId,
            status: 'unresolved'
          });
          
          // Update local record sync status
          await updateLocalRecordConflictStatus(operation);
          
          syncProgress.conflicts++;
          console.log(`Operation ${operation.id} has conflict`);
        } else if (result.status === 'deferred') {
          // Captured by a colleague on this device: it waits until they sync it themselves
          syncProgress.deferred = (syncProgress.deferred || 0) + 1;
          deferredIds.add(operation.id);
        } else if (result.status === 'held') {
          // Kept on the server for an administrator to review; stop sending it
          await markOperationHeld(operation.id, result.reason);
          await setStatus(operation.entityType, operation.recordId, 'held').catch(() => {});
          // A possible second entry of the same delivery note leaves this device's stock balance
          if (result.reason === 'duplicate_delivery' && operation.entityType === 'stockMovement') {
            await db.stockMovements.update(operation.recordId, { heldReason: result.reason }).catch(() => {});
          }
          // The person can no longer sign in offline here until they sign in online
          if (result.capturedBy && (result.reason === 'user_deactivated' || result.reason === 'password_reset')) {
            await forgetOfflineUser(result.capturedBy).catch(() => {});
          }
          syncProgress.held = (syncProgress.held || 0) + 1;
        } else if (result.httpStatus === 401) {
          // Session rejected by the server: stop, and keep this and the remaining operations
          // pending without counting a retry
          return {
            success: false,
            authRequired: true,
            message: SIGN_IN_TO_SYNC,
            progress: syncProgress
          };
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
        blockedRecords.add(key);

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

    // What went up is now on the server: download it with the rest of the school's changes
    if (syncProgress.successful > 0) await download(schoolId);

    // Still waiting: anything pending except a colleague's records, which only they can send,
    // and changes held back behind a conflict, which wait for an administrator
    const waiting = (await getPendingOperations())
      .filter((op) => !deferredIds.has(op.id) && !blockedIds.has(op.id)).length;
    lastPass = {
      waiting,
      madeProgress: syncProgress.successful + syncProgress.conflicts + (syncProgress.held || 0) > 0
    };

    return {
      success: true,
      message: 'Everything waiting has been sent.',
      progress: syncProgress
    };
  } catch (error) {
    console.error('Error processing sync queue:', error);
    return {
      success: false,
      // The error itself goes to the console; the person only needs to know it will be retried
      message: 'Some records did not send. Lishe will try again.',
      progress: syncProgress
    };
  } finally {
    isSyncing = false;
    console.log('Sync process completed, isSyncing set to false');
    planNextSync(lastPass);
  }
}

function recordKey(operation) {
  return `${operation.entityType}:${operation.recordId}`;
}

/**
 * Records with an unresolved conflict, or a queued change that is in conflict or has
 * failed: their later changes are held back.
 */
async function recordsWithUnfinishedChanges() {
  const keys = new Set();
  const conflicts = await db.conflicts.where('status').equals('unresolved').toArray();
  conflicts.forEach((c) => keys.add(recordKey(c)));
  const stuck = await db.syncQueue.where('status').anyOf('conflict', 'failed').toArray();
  stuck.forEach((op) => keys.add(recordKey(op)));
  return keys;
}

// Editable records on the device, by sync entity type
const LOCAL_TABLES = {
  attendance: 'attendance',
  mealDistribution: 'mealDistribution',
  enrolment: 'enrolment',
  dailyFeeding: 'dailyFeeding',
};
// The record types added with the stock ledger, and their tables
const FEEDING_TABLES = {
  enrolment: 'enrolment',
  dailyFeeding: 'dailyFeeding',
  stockMovement: 'stockMovements',
  stockCount: 'stockCounts',
};

async function setStatus(entityType, recordId, syncStatus) {
  if (FEEDING_TABLES[entityType]) {
    await db[FEEDING_TABLES[entityType]].update(recordId, { syncStatus });
    return;
  }
  await setLocalSyncStatus(entityType, recordId, syncStatus);
}

/** The school this device is set up for, or null (an administrator's own computer). */
async function deviceSchoolId() {
  try {
    return (await getDeviceIdentity())?.schoolId || null;
  } catch {
    return null;
  }
}

/** Download the school's changes; a failed download never stops records being sent. */
async function download(schoolId) {
  if (!schoolId) return;
  try {
    syncProgress.downloaded = (syncProgress.downloaded || 0) + (await pullChanges(schoolId));
  } catch (error) {
    console.error('Error downloading changes:', error);
  }
}

/**
 * An update says which server record it was based on, once that is known, so the server
 * can refuse an edit that would land on a different record with the same version.
 */
async function withBaseRecord(operation) {
  if (operation.operation !== 'update' || !LOCAL_TABLES[operation.entityType]) return operation;
  const record = await db[LOCAL_TABLES[operation.entityType]].get(operation.recordId);
  return record?.serverId ? { ...operation, baseRecordId: record.serverId } : operation;
}

/**
 * Update local record after successful sync
 */
async function updateLocalRecordAfterSync(operation, syncResult) {
  try {
    // Keep the server record id so pages can match this record to the server's copy
    const updates = {
      syncStatus: 'synced',
      version: syncResult.version,
      ...(syncResult.recordId && { serverId: syncResult.recordId }),
      // Merged with the server's copy: take the fields this device had left empty
      ...(FEEDING_TABLES[operation.entityType] && syncResult.mergedFields)
    };
    if (operation.entityType === 'attendance') {
      await updateLocalAttendance(operation.recordId, updates);
    } else if (operation.entityType === 'mealDistribution') {
      await updateLocalMeal(operation.recordId, updates);
    } else if (FEEDING_TABLES[operation.entityType]) {
      // Status and server copy only: an edit through feedingDb would queue another change
      await db[FEEDING_TABLES[operation.entityType]].update(operation.recordId, updates);
    }
  } catch (error) {
    console.error('Error updating local record after sync:', error);
  }
}

/**
 * Update local record conflict status
 */
async function updateLocalRecordConflictStatus(operation) {
  try {
    // Status only: an edit here would bump the version and queue another stale update
    await setStatus(operation.entityType, operation.recordId, 'conflict');
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
 * Automatic sync: when the connection returns, when the app opens or comes back into view,
 * and while online, retries for records still waiting (#74). Returns a cleanup function.
 */
export function setupAutoSync() {
  autoRetry = true;

  const syncSoon = () => {
    if (!isOnline()) return;
    // A fresh start for the retry schedule; wait a moment for the connection to settle
    retryStep = 0;
    syncLater(AUTO_SYNC_DELAY_MS);
  };
  const handleOnline = () => {
    console.log('Connection restored, triggering automatic sync in 5 seconds');
    syncSoon();
  };
  const handleOffline = () => clearRetry();
  const handleVisible = () => {
    if (document.visibilityState === 'visible' && !retryTimer && !isSyncing) syncSoon();
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', handleVisible);

  // Records stranded by older versions of the app go back in the queue; then sync what is waiting
  requeueConnectionFailures().finally(syncSoon);

  return () => {
    autoRetry = false;
    clearRetry();
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', handleVisible);
  };
}
