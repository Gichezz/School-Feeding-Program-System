import PageIntro from '../components/PageIntro';

/**
 * Synchronization status page (placeholder for future offline sync)
 */
function SyncStatus() {
  return (
    <PageIntro
      title="Synchronization Status"
      purpose="Monitor offline data synchronization and conflict resolution"
    >
      <div className="empty-state">
        <h3>Online Synchronization</h3>
        <p>
          The application is currently operating in online mode. All data is being sent directly to the server.
        </p>
        <p style={{ marginTop: '1rem' }}>
          Offline synchronization will be available after the offline synchronization module is implemented in a later phase.
        </p>
      </div>

      <div className="form-section" style={{ marginTop: '2rem' }}>
        <h2>Future Features</h2>
        <p style={{ color: 'var(--color-muted)', lineHeight: '1.6' }}>
          When offline synchronization is implemented, this page will display:
        </p>
        <ul style={{ color: 'var(--color-muted)', lineHeight: '1.8', marginTop: '1rem' }}>
          <li>Online/offline connection status</li>
          <li>Pending operations waiting to sync</li>
          <li>Last synchronization time</li>
          <li>Synchronization errors and conflicts</li>
          <li>Conflict resolution interface</li>
        </ul>
      </div>
    </PageIntro>
  );
}

export default SyncStatus;
