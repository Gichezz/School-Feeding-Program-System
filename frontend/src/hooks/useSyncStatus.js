import { createContext, createElement, useCallback, useContext, useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import db from '../db/database';
import { manualSync, getSyncProgress, isSyncInProgress } from '../sync/syncManager';
import { useOnlineStatus } from './useOnlineStatus';
import { useSession } from './useSession';

const EMPTY = { pending: 0, failed: 0, lastSyncedAt: null, lastError: null, unresolvedConflicts: 0 };
const PROGRESS_POLL_MS = 400;
const SyncStatusContext = createContext(null);

/**
 * The one state the sync status bar shows, most important first. Offline and
 * syncing describe what is happening now. Paused means the device is online but
 * nothing can be sent until someone acts (sign in again, set the device up again),
 * so it comes before everything that depends on sending. A conflict needs a person
 * to decide, so it comes before failed changes, which Lishe retries by itself.
 *
 * pausedReason: null, or why sending cannot happen (see pausedReasonFor)
 * @returns {'offline' | 'paused' | 'syncing' | 'conflict' | 'failed' | 'synced'}
 */
export function syncStateFor({ isOnline, syncing, failedCount, conflictCount, pausedReason = null }) {
  if (!isOnline) return 'offline';
  if (pausedReason) return 'paused';
  if (syncing) return 'syncing';
  if (conflictCount > 0) return 'conflict';
  if (failedCount > 0) return 'failed';
  return 'synced';
}

/**
 * Why records cannot be sent although the device may be online, or null.
 * Read from the session only; it does not change how or when syncing runs.
 *
 * @returns {null | 'signIn' | 'deviceRemoved'}
 */
export function pausedReasonFor(session, isValid) {
  if (!session || isValid) return null;
  return session.endedReason === 'deviceRevoked' ? 'deviceRemoved' : 'signIn';
}

/**
 * Read-only summary of the sync queue for the SyncStatusBar and navigation badges.
 * It reads the local database and the sync manager's progress; it does not change
 * how syncing works. Provided once by the app shell (one subscription, one timer).
 *
 * state: see syncStateFor
 */
function useSyncStatusSource() {
  const isOnline = useOnlineStatus();
  const { session, isValid: signedIn } = useSession();
  const pausedReason = pausedReasonFor(session, signedIn);
  const [queue, setQueue] = useState(EMPTY);
  const [syncing, setSyncing] = useState(() => isSyncInProgress());
  const [progress, setProgress] = useState(0);

  // Live view of the queue and conflicts in IndexedDB
  useEffect(() => {
    const subscription = liveQuery(async () => {
      const operations = await db.syncQueue.toArray();
      const unresolvedConflicts = await db.conflicts.where('status').equals('unresolved').count();
      let lastSyncedAt = null;
      let lastError = null;
      let lastErrorAt = '';
      for (const op of operations) {
        if (op.status === 'synced' && op.lastAttemptAt && (!lastSyncedAt || op.lastAttemptAt > lastSyncedAt)) {
          lastSyncedAt = op.lastAttemptAt;
        }
        const attemptFailed = op.status === 'failed' || (op.status === 'pending' && op.errorMessage);
        if (attemptFailed && (op.lastAttemptAt || '') >= lastErrorAt) {
          lastError = op.errorMessage || null;
          lastErrorAt = op.lastAttemptAt || '';
        }
      }
      return {
        pending: operations.filter((op) => op.status === 'pending').length,
        failed: operations.filter((op) => op.status === 'failed' || (op.status === 'pending' && op.errorMessage)).length,
        lastSyncedAt,
        lastError,
        unresolvedConflicts,
      };
    }).subscribe({ next: setQueue, error: () => setQueue(EMPTY) });
    return () => subscription.unsubscribe();
  }, []);

  // Follow syncs started anywhere (Sync now, or automatically when back online)
  useEffect(() => {
    const timer = setInterval(() => {
      const running = isSyncInProgress();
      setSyncing(running);
      if (running) {
        const { total, processed } = getSyncProgress();
        setProgress(total > 0 ? (processed / total) * 100 : 0);
      }
    }, PROGRESS_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    setProgress(0);
    try {
      return await manualSync();
    } finally {
      setSyncing(isSyncInProgress());
    }
  }, []);

  const state = syncStateFor({
    isOnline,
    syncing,
    failedCount: queue.failed,
    conflictCount: queue.unresolvedConflicts,
    pausedReason,
  });

  // Described whenever something failed, even while a conflict takes the bar
  const failure = queue.failed > 0
    ? {
      what: queue.failed === 1 ? '1 change not sent – will retry' : `${queue.failed} changes not sent – will retry`,
      // The server's own message is for the logs, not for the person recording
      why: 'Lishe could not send it.',
      fix: 'Your records are safe on this device. Check the connection and press Sync now.',
    }
    : null;

  return {
    state,
    pendingCount: queue.pending,
    failedCount: queue.failed,
    progress,
    lastSyncedAt: queue.lastSyncedAt,
    failure,
    unresolvedConflicts: queue.unresolvedConflicts,
    pausedReason,
    signedInOffline: Boolean(session?.offline),
    canSync: isOnline && signedIn,
    syncNow,
  };
}

export function SyncStatusProvider({ children }) {
  return createElement(SyncStatusContext.Provider, { value: useSyncStatusSource() }, children);
}

export function useSyncStatus() {
  const value = useContext(SyncStatusContext);
  if (!value) throw new Error('useSyncStatus must be used inside <SyncStatusProvider>');
  return value;
}
