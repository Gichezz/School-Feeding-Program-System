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
 * Read-only summary of the sync queue for the SyncStatusBar and navigation badges.
 * It reads the local database and the sync manager's progress; it does not change
 * how syncing works. Provided once by the app shell (one subscription, one timer).
 *
 * state: 'offline' | 'syncing' | 'failed' | 'synced'
 */
function useSyncStatusSource() {
  const isOnline = useOnlineStatus();
  const { isValid: signedIn } = useSession();
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

  let state = 'synced';
  if (!isOnline) state = 'offline';
  else if (syncing) state = 'syncing';
  else if (queue.failed > 0) state = 'failed';

  const failure = state === 'failed'
    ? {
      what: queue.failed === 1 ? '1 change did not sync' : `${queue.failed} changes did not sync`,
      why: queue.lastError || 'The server could not be reached.',
      fix: 'Your records are safe on this device. Check the connection and press Sync now; Lishe also retries automatically.',
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
