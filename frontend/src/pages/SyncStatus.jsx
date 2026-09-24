import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import PageIntro from '../components/PageIntro';
import LoadingSpinner from '../components/LoadingSpinner';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { 
  getComprehensiveSyncStatus, 
  manualSync, 
  isSyncInProgress,
  getSyncProgress 
} from '../sync/syncManager';
import { getSyncQueueStats, getAllOperations } from '../sync/syncQueue';
import { getConflictStats } from '../sync/conflictService';

/**
 * Synchronization status page for Phase 6
 * Displays comprehensive sync status and allows manual sync
 */
function SyncStatus() {
  const isOnline = useOnlineStatus();
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState(null);
  const [queueStats, setQueueStats] = useState(null);
  const [conflictStats, setConflictStats] = useState(null);
  const [recentOperations, setRecentOperations] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(null);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const prevSyncingRef = useRef(false);

  useEffect(() => {
    loadSyncStatus();
    
    // Monitor sync state and refresh when it changes
    const interval = setInterval(() => {
      const currentlySyncing = isSyncInProgress();
      
      // Refresh if sync is in progress OR if sync just completed
      if (currentlySyncing || (prevSyncingRef.current && !currentlySyncing)) {
        loadSyncStatus();
      }
      
      prevSyncingRef.current = currentlySyncing;
    }, 2000);
    
    // Listen for sync completion events
    const handleSyncCompleted = () => {
      console.log('Sync completed event received, refreshing status');
      loadSyncStatus();
    };
    
    window.addEventListener('syncCompleted', handleSyncCompleted);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('syncCompleted', handleSyncCompleted);
    };
  }, []);

  const loadSyncStatus = async () => {
    try {
      // Only set loading to true on initial load, not on refreshes
      if (!syncStatus && !queueStats) {
        setLoading(true);
      }
      setError(null);

      const [status, stats, operations, conflicts] = await Promise.all([
        getComprehensiveSyncStatus(),
        getSyncQueueStats(),
        getAllOperations(),
        getConflictStats()
      ]);

      let hasChanges = false;

      // Only update state if values have actually changed
      if (JSON.stringify(syncStatus) !== JSON.stringify(status)) {
        setSyncStatus(status);
        hasChanges = true;
      }
      
      if (JSON.stringify(queueStats) !== JSON.stringify(stats)) {
        setQueueStats(stats);
        hasChanges = true;
      }
      
      if (JSON.stringify(conflictStats) !== JSON.stringify(conflicts)) {
        setConflictStats(conflicts);
        hasChanges = true;
      }
      
      const newOps = operations.slice(-10).reverse();
      if (JSON.stringify(recentOperations) !== JSON.stringify(newOps)) {
        setRecentOperations(newOps);
        hasChanges = true;
      }
      
      const currentSyncing = isSyncInProgress();
      if (syncing !== currentSyncing) {
        setSyncing(currentSyncing);
        hasChanges = true;
      }
      
      const currentProgress = getSyncProgress();
      if (JSON.stringify(syncProgress) !== JSON.stringify(currentProgress)) {
        setSyncProgress(currentProgress);
        hasChanges = true;
      }

      // Only update timestamp if there were changes
      if (hasChanges) {
        setLastUpdated(new Date().toLocaleTimeString());
      }
    } catch (err) {
      console.error('Error loading sync status:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleManualSync = async () => {
    try {
      console.log('Manual sync button clicked');
      setSyncing(true);
      setError(null);
      setSuccessMessage(null);

      console.log('Calling manualSync...');
      const result = await manualSync();
      console.log('Manual sync result:', result);
      
      if (result.success) {
        setSuccessMessage(result.message);
        // Force refresh after sync completes to show updated status
        setTimeout(() => loadSyncStatus(), 500);
      } else {
        setError(result.message);
      }
    } catch (err) {
      console.error('Manual sync error:', err);
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <PageIntro
        title="Synchronization Status"
        purpose="Monitor offline data synchronization and conflict resolution"
      >
        <LoadingSpinner message="Loading synchronization status..." />
      </PageIntro>
    );
  }

  return (
    <PageIntro
      title="Synchronization Status"
      purpose="Monitor offline data synchronization and conflict resolution"
    >
      {error && <div className="form-error">{error}</div>}
      {successMessage && <div className="form-success">{successMessage}</div>}

      {/* Connection Status */}
      <section className="form-section">
        <h2>Connection Status</h2>
        <div style={{ 
          padding: '1rem', 
          borderRadius: '4px',
          backgroundColor: isOnline ? 'var(--color-success-bg)' : 'var(--color-error-bg)',
          color: isOnline ? 'var(--color-success-text)' : 'var(--color-error-text)',
          marginBottom: '1rem'
        }}>
          <strong>{isOnline ? '🟢 Online' : '🔴 Offline'}</strong>
          <p style={{ margin: '0.5rem 0 0 0' }}>
            {isOnline 
              ? 'Connected to server. Synchronization is available.' 
              : 'No internet connection. Working in offline mode.'}
          </p>
        </div>

        {isOnline && (
          <div className="form-actions">
            <button 
              className="btn btn--primary" 
              onClick={handleManualSync}
              disabled={syncing}
            >
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
        )}
      </section>

      {/* Sync Progress */}
      {syncing && syncProgress && (
        <section className="form-section">
          <h2>Sync Progress</h2>
          <div style={{ 
            padding: '1rem', 
            backgroundColor: 'var(--color-info-bg)',
            borderRadius: '4px'
          }}>
            <p><strong>Total:</strong> {syncProgress.total}</p>
            <p><strong>Processed:</strong> {syncProgress.processed}</p>
            <p><strong>Successful:</strong> {syncProgress.successful}</p>
            <p><strong>Failed:</strong> {syncProgress.failed}</p>
            <p><strong>Conflicts:</strong> {syncProgress.conflicts}</p>
          </div>
        </section>
      )}

      {/* Queue Statistics */}
      <section className="form-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Sync Queue Statistics</h2>
          {lastUpdated && (
            <span style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>
              Last updated: {lastUpdated}
            </span>
          )}
        </div>
        {queueStats ? (
          <div style={{ 
            padding: '1rem', 
            backgroundColor: 'var(--color-muted-bg)',
            borderRadius: '4px'
          }}>
            <p><strong>Total Operations:</strong> {queueStats.total}</p>
            <p><strong>Pending:</strong> {queueStats.pending}</p>
            <p><strong>Synced:</strong> {queueStats.synced}</p>
            <p><strong>Failed:</strong> {queueStats.failed}</p>
            <p><strong>Conflicts:</strong> {queueStats.conflict}</p>
          </div>
        ) : (
          <p>No queue statistics available</p>
        )}
      </section>

      {/* Conflict Statistics */}
      {conflictStats && conflictStats.unresolved > 0 && (
        <section className="form-section" style={{ 
          backgroundColor: 'var(--color-warning-bg)',
          padding: '1rem',
          borderRadius: '4px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0 }}>⚠️ Unresolved Conflicts</h2>
            <Link 
              to="/conflicts" 
              className="btn btn--primary"
              style={{ fontSize: '0.9rem' }}
            >
              View Conflicts
            </Link>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <p><strong>Total Conflicts:</strong> {conflictStats.total}</p>
            <p><strong>Unresolved:</strong> {conflictStats.unresolved}</p>
            <p><strong>Resolved:</strong> {conflictStats.resolved}</p>
          </div>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            You have {conflictStats.unresolved} unresolved conflict(s) that require your attention. 
            These occur when the server has a newer version of a record than your local changes.
          </p>
        </section>
      )}

      {/* Recent Operations */}
      <section className="form-section">
        <h2>Recent Operations</h2>
        {recentOperations.length === 0 ? (
          <div className="empty-state">
            <p>No operations in queue</p>
          </div>
        ) : (
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Entity</th>
                  <th>Operation</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Retries</th>
                </tr>
              </thead>
              <tbody>
                {recentOperations.map((op) => (
                  <tr key={op.id}>
                    <td>{op.entityType}</td>
                    <td>{op.recordId}</td>
                    <td>{op.operation}</td>
                    <td>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '0.85rem',
                        backgroundColor: op.status === 'synced' ? 'var(--color-success-bg)' :
                                       op.status === 'conflict' ? 'var(--color-error-bg)' :
                                       op.status === 'failed' ? 'var(--color-warning-bg)' :
                                       'var(--color-muted-bg)',
                        color: op.status === 'synced' ? 'var(--color-success-text)' :
                               op.status === 'conflict' ? 'var(--color-error-text)' :
                               op.status === 'failed' ? 'var(--color-warning-text)' :
                               'var(--color-muted-text)'
                      }}>
                        {op.status}
                      </span>
                    </td>
                    <td>{new Date(op.createdAt).toLocaleString()}</td>
                    <td>{op.retryCount || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Information */}
      <section className="form-section">
        <h2>Synchronization Information</h2>
        <div style={{ color: 'var(--color-muted)', lineHeight: '1.6' }}>
          <p><strong>How it works:</strong></p>
          <ul style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
            <li>When you create or update records offline, they are saved locally and queued for synchronization</li>
            <li>When you go online, the system automatically attempts to synchronize pending operations</li>
            <li>Each operation includes a version number to prevent conflicts</li>
            <li>If a version mismatch is detected, the operation is marked as a conflict</li>
            <li>You can manually trigger synchronization using the "Sync Now" button</li>
            <li>Conflicts can be resolved using the Conflicts page</li>
          </ul>
          <p><strong>Status meanings:</strong></p>
          <ul style={{ marginTop: '0.5rem' }}>
            <li><strong>Pending:</strong> Waiting to be synchronized</li>
            <li><strong>Synced:</strong> Successfully synchronized with server</li>
            <li><strong>Failed:</strong> Synchronization failed (will be retried)</li>
            <li><strong>Conflict:</strong> Version mismatch detected (requires resolution)</li>
          </ul>
        </div>
      </section>
    </PageIntro>
  );
}

export default SyncStatus;
