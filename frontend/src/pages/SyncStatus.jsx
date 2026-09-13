import PageIntro from '../components/PageIntro';

/**
 * Synchronization status section placeholder.
 */
function SyncStatus() {
  return (
    <PageIntro
      title="Synchronization Status"
      purpose="This section will show the state of local records waiting to reach the central server, including pending operations and conflicts. The synchronization engine will be implemented in a later phase."
    >
      <p className="placeholder-note">
        Synchronization status is not available yet.
      </p>
    </PageIntro>
  );
}

export default SyncStatus;
