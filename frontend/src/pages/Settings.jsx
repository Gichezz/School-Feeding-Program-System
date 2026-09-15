import PageIntro from '../components/PageIntro';

/**
 * Settings page (basic placeholder for future expansion)
 */
function Settings() {
  return (
    <PageIntro
      title="Settings"
      purpose="Application configuration and preferences"
    >
      <div className="form-section">
        <h2>Application Settings</h2>
        <p style={{ color: 'var(--color-muted)', lineHeight: '1.6' }}>
          Basic application settings will be available here in future phases.
        </p>
      </div>

      <div className="form-section">
        <h2>School Profile</h2>
        <p style={{ color: 'var(--color-muted)', lineHeight: '1.6' }}>
          School-specific settings and profile information will be configurable here in a later phase.
        </p>
      </div>

      <div className="form-section">
        <h2>User Preferences</h2>
        <p style={{ color: 'var(--color-muted)', lineHeight: '1.6' }}>
          User preferences and display settings will be available here in a later phase.
        </p>
      </div>

      <div className="form-section">
        <h2>Device Information</h2>
        <p style={{ color: 'var(--color-muted)', lineHeight: '1.6' }}>
          Device identity and synchronization settings will be managed here when offline functionality is implemented.
        </p>
      </div>
    </PageIntro>
  );
}

export default Settings;
