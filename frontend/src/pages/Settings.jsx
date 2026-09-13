import PageIntro from '../components/PageIntro';

/**
 * Settings section placeholder.
 */
function Settings() {
  return (
    <PageIntro
      title="Settings"
      purpose="This section will hold school profile, device identity, and user preferences. Authentication and device settings will be added in a later phase."
    >
      <p className="placeholder-note">
        Settings are not available yet.
      </p>
    </PageIntro>
  );
}

export default Settings;
