import { useState, useEffect } from 'react';
import PageIntro from '../components/PageIntro';
import LoadingSpinner from '../components/LoadingSpinner';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { 
  getUnresolvedConflicts, 
  getConflictStats,
  resolveConflict,
  deleteConflict 
} from '../sync/conflictService';
import { getSchools } from '../services/api';
import { getCachedSchools } from '../services/localDb';

/**
 * Conflicts page for Phase 7
 * Displays unresolved conflicts and allows user-controlled resolution
 */
function Conflicts() {
  const isOnline = useOnlineStatus();
  const [loading, setLoading] = useState(true);
  const [conflicts, setConflicts] = useState([]);
  const [conflictStats, setConflictStats] = useState(null);
  const [selectedConflict, setSelectedConflict] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [schools, setSchools] = useState([]);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingResolution, setPendingResolution] = useState(null);

  useEffect(() => {
    loadConflicts();
    loadSchools();
  }, []);

  const loadSchools = async () => {
    try {
      let schoolsData = [];
      try {
        const schoolsResponse = await getSchools();
        schoolsData = schoolsResponse.schools || [];
      } catch (serverError) {
        console.warn('Server unavailable, using cached schools:', serverError.message);
        try {
          schoolsData = await getCachedSchools();
        } catch (cacheError) {
          console.warn('Could not get cached schools:', cacheError.message);
          schoolsData = [];
        }
      }
      setSchools(schoolsData);
    } catch (err) {
      console.error('Error loading schools:', err);
    }
  };

  const loadConflicts = async () => {
    try {
      setLoading(true);
      setError(null);

      const [unresolvedConflicts, stats] = await Promise.all([
        getUnresolvedConflicts(),
        getConflictStats()
      ]);

      setConflicts(unresolvedConflicts);
      setConflictStats(stats);
    } catch (err) {
      console.error('Error loading conflicts:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getSchoolName = (schoolId) => {
    const school = schools.find(s => s.id === schoolId || s.id === parseInt(schoolId));
    return school ? school.name : 'Unknown School';
  };

  const formatDateForDisplay = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleString();
  };

  const handleSelectConflict = (conflict) => {
    setSelectedConflict(conflict);
    setError(null);
    setSuccessMessage(null);
  };

  const handleBackToList = () => {
    setSelectedConflict(null);
    setError(null);
    setSuccessMessage(null);
  };

  const handleResolveClick = (resolution) => {
    if (!isOnline) {
      setError('Conflict resolution requires an internet connection');
      return;
    }
    setPendingResolution(resolution);
    setShowConfirmDialog(true);
  };

  const handleConfirmResolution = async () => {
    if (!selectedConflict || !pendingResolution) return;

    try {
      setResolving(true);
      setError(null);
      setShowConfirmDialog(false);

      const result = await resolveConflict(selectedConflict.id, pendingResolution);

      setSuccessMessage(
        `Conflict resolved successfully using "${pendingResolution}" strategy. Record updated to version ${result.version}.`
      );

      // Reload conflicts after successful resolution
      setTimeout(() => {
        loadConflicts();
        setSelectedConflict(null);
      }, 1500);

    } catch (err) {
      console.error('Error resolving conflict:', err);
      if (err.message.includes('Stale conflict')) {
        setError('This conflict is no longer valid. The server record has been modified. Please refresh and try again.');
      } else {
        setError(err.message);
      }
    } finally {
      setResolving(false);
      setPendingResolution(null);
    }
  };

  const handleCancelResolution = () => {
    setShowConfirmDialog(false);
    setPendingResolution(null);
  };

  const handleDeleteConflict = async (conflictId) => {
    try {
      await deleteConflict(conflictId);
      setSuccessMessage('Conflict deleted from local storage');
      loadConflicts();
    } catch (err) {
      console.error('Error deleting conflict:', err);
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <PageIntro
        title="Conflict Resolution"
        purpose="Review and resolve synchronization conflicts"
      >
        <LoadingSpinner message="Loading conflicts..." />
      </PageIntro>
    );
  }

  return (
    <PageIntro
      title="Conflict Resolution"
      purpose="Review and resolve synchronization conflicts between local and server data"
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
              ? 'Connected to server. Conflict resolution is available.' 
              : 'No internet connection. Conflict resolution requires connectivity.'}
          </p>
        </div>
      </section>

      {/* Conflict Statistics */}
      {conflictStats && (
        <section className="form-section">
          <h2>Conflict Statistics</h2>
          <div style={{ 
            padding: '1rem', 
            backgroundColor: 'var(--color-muted-bg)',
            borderRadius: '4px'
          }}>
            <p><strong>Total Conflicts:</strong> {conflictStats.total}</p>
            <p><strong>Unresolved:</strong> {conflictStats.unresolved}</p>
            <p><strong>Resolved:</strong> {conflictStats.resolved}</p>
          </div>
        </section>
      )}

      {/* Conflict List or Detail View */}
      {!selectedConflict ? (
        <section className="form-section">
          <h2>Unresolved Conflicts</h2>
          {conflicts.length === 0 ? (
            <div className="empty-state">
              <p>No unresolved conflicts</p>
            </div>
          ) : (
            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Record ID</th>
                    <th>Date</th>
                    <th>School</th>
                    <th>Versions</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {conflicts.map((conflict) => (
                    <tr key={conflict.id}>
                      <td>{conflict.entityType}</td>
                      <td>{conflict.recordId}</td>
                      <td>
                        {conflict.localPayload?.attendanceDate || conflict.localPayload?.distributionDate || 'N/A'}
                      </td>
                      <td>{getSchoolName(conflict.localPayload?.schoolId)}</td>
                      <td>
                        <span style={{ fontSize: '0.85rem' }}>
                          Local: v{conflict.baseVersion} / Server: v{conflict.serverVersion}
                        </span>
                      </td>
                      <td>{formatDateTime(conflict.createdAt)}</td>
                      <td>
                        <button
                          className="btn btn--small"
                          onClick={() => handleSelectConflict(conflict)}
                          disabled={resolving}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section className="form-section">
          <div style={{ marginBottom: '1rem' }}>
            <button
              className="btn btn--secondary"
              onClick={handleBackToList}
              disabled={resolving}
            >
              ← Back to Conflicts
            </button>
          </div>

          <h2>Conflict Details</h2>
          
          {/* Conflict Header */}
          <div style={{ 
            padding: '1rem', 
            backgroundColor: 'var(--color-warning-bg)',
            borderRadius: '4px',
            marginBottom: '1rem'
          }}>
            <p><strong>Entity Type:</strong> {selectedConflict.entityType}</p>
            <p><strong>Record ID:</strong> {selectedConflict.recordId}</p>
            <p><strong>Date:</strong> {selectedConflict.localPayload?.attendanceDate || selectedConflict.localPayload?.distributionDate || 'N/A'}</p>
            <p><strong>School:</strong> {getSchoolName(selectedConflict.localPayload?.schoolId)}</p>
            <p><strong>Conflict ID:</strong> {selectedConflict.conflictId}</p>
            <p><strong>Created:</strong> {formatDateTime(selectedConflict.createdAt)}</p>
          </div>

          {/* Version Information */}
          <div style={{ 
            padding: '1rem', 
            backgroundColor: 'var(--color-info-bg)',
            borderRadius: '4px',
            marginBottom: '1rem'
          }}>
            <h3 style={{ marginTop: 0 }}>Version Information</h3>
            <p><strong>Base Version:</strong> {selectedConflict.baseVersion}</p>
            <p><strong>Server Version:</strong> {selectedConflict.serverVersion}</p>
            <p style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
              <em>Version mismatch detected. The local change was based on version {selectedConflict.baseVersion}, but the server is currently at version {selectedConflict.serverVersion}.</em>
            </p>
          </div>

          {/* Side-by-side comparison */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            {/* Local Version */}
            <div style={{ 
              padding: '1rem', 
              backgroundColor: 'var(--color-muted-bg)',
              borderRadius: '4px',
              border: '2px solid var(--color-primary)'
            }}>
              <h3 style={{ marginTop: 0, color: 'var(--color-primary)' }}>Local Version</h3>
              <p><em>Your changes stored on this device</em></p>
              
              {selectedConflict.entityType === 'attendance' && (
                <div>
                  <p><strong>Total Registered:</strong> {selectedConflict.localPayload?.totalRegistered}</p>
                  <p><strong>Total Present:</strong> {selectedConflict.localPayload?.totalPresent}</p>
                  <p><strong>Total Absent:</strong> {selectedConflict.localPayload?.totalAbsent}</p>
                </div>
              )}
              
              {selectedConflict.entityType === 'mealDistribution' && (
                <div>
                  <p><strong>Meals Prepared:</strong> {selectedConflict.localPayload?.mealsPrepared}</p>
                  <p><strong>Meals Served:</strong> {selectedConflict.localPayload?.mealsServed}</p>
                </div>
              )}
            </div>

            {/* Server Version */}
            <div style={{ 
              padding: '1rem', 
              backgroundColor: 'var(--color-muted-bg)',
              borderRadius: '4px',
              border: '2px solid var(--color-success)'
            }}>
              <h3 style={{ marginTop: 0, color: 'var(--color-success)' }}>Server Version</h3>
              <p><em>Current data on the central server</em></p>
              
              {selectedConflict.entityType === 'attendance' && selectedConflict.serverRecord && (
                <div>
                  <p><strong>Total Registered:</strong> {selectedConflict.serverRecord?.total_registered}</p>
                  <p><strong>Total Present:</strong> {selectedConflict.serverRecord?.total_present}</p>
                  <p><strong>Total Absent:</strong> {selectedConflict.serverRecord?.total_absent}</p>
                </div>
              )}
              
              {selectedConflict.entityType === 'mealDistribution' && selectedConflict.serverRecord && (
                <div>
                  <p><strong>Meals Prepared:</strong> {selectedConflict.serverRecord?.meals_prepared}</p>
                  <p><strong>Meals Served:</strong> {selectedConflict.serverRecord?.meals_served}</p>
                </div>
              )}
            </div>
          </div>

          {/* Resolution Options */}
          <div style={{ 
            padding: '1rem', 
            backgroundColor: 'var(--color-info-bg)',
            borderRadius: '4px',
            marginBottom: '1rem'
          }}>
            <h3 style={{ marginTop: 0 }}>Resolution Options</h3>
            <p style={{ marginBottom: '1rem' }}>Choose which version should become the authoritative record:</p>
            
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <button
                className="btn btn--primary"
                onClick={() => handleResolveClick('keep_server')}
                disabled={resolving || !isOnline}
                style={{ flex: '1', minWidth: '200px' }}
              >
                Keep Server Version
              </button>
              
              <button
                className="btn btn--primary"
                onClick={() => handleResolveClick('keep_local')}
                disabled={resolving || !isOnline}
                style={{ flex: '1', minWidth: '200px' }}
              >
                Keep Local Version
              </button>
            </div>
            
            {!isOnline && (
              <p style={{ marginTop: '0.5rem', color: 'var(--color-error-text)', fontSize: '0.9rem' }}>
                ⚠️ Resolution requires internet connection
              </p>
            )}
          </div>

          {/* Additional Actions */}
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              className="btn btn--secondary"
              onClick={() => handleDeleteConflict(selectedConflict.id)}
              disabled={resolving}
            >
              Delete from Local
            </button>
          </div>
        </section>
      )}

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '2rem',
            borderRadius: '8px',
            maxWidth: '500px',
            width: '90%'
          }}>
            <h3>Confirm Resolution</h3>
            <p style={{ marginBottom: '1rem' }}>
              You are about to resolve this conflict by choosing <strong>"{pendingResolution}"</strong>.
            </p>
            <p style={{ marginBottom: '1rem' }}>
              {pendingResolution === 'keep_server' 
                ? 'The server version will become authoritative. Your local changes will be discarded.'
                : 'Your local version will become the new server version. This will update the central server.'}
            </p>
            <p style={{ marginBottom: '1rem', fontWeight: 'bold' }}>
              This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
              <button
                className="btn btn--secondary"
                onClick={handleCancelResolution}
                disabled={resolving}
              >
                Cancel
              </button>
              <button
                className="btn btn--primary"
                onClick={handleConfirmResolution}
                disabled={resolving}
              >
                {resolving ? 'Resolving...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Information */}
      <section className="form-section">
        <h2>About Conflict Resolution</h2>
        <div style={{ color: 'var(--color-muted)', lineHeight: '1.6' }}>
          <p><strong>What causes conflicts?</strong></p>
          <p style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
            Conflicts occur when multiple devices or users try to update the same record simultaneously. 
            The system uses version numbers to detect when a local change was based on an older version of the data.
          </p>
          <p><strong>How to resolve:</strong></p>
          <ul style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
            <li><strong>Keep Server Version:</strong> Discard your local changes and use the current server data</li>
            <li><strong>Keep Local Version:</strong> Apply your local changes to the server, overwriting the current server data</li>
          </ul>
          <p><strong>Important:</strong></p>
          <ul style={{ marginTop: '0.5rem' }}>
            <li>Resolution requires an internet connection</li>
            <li>All resolutions are recorded in the audit trail</li>
            <li>Choose carefully - resolution actions cannot be undone</li>
          </ul>
        </div>
      </section>
    </PageIntro>
  );
}

export default Conflicts;
