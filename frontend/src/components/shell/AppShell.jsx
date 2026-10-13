import { Link, Outlet } from 'react-router-dom';
import { Alert, Button } from '../ui';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import BottomNav from './BottomNav';
import { SyncStatusProvider } from '../../hooks/useSyncStatus';
import { useSession } from '../../hooks/useSession';

/**
 * Signed-in app frame: sidebar or icon strip (tablet and desktop) or bottom tabs
 * (mobile), the top bar, and the page content.
 */
function AppShell() {
  const { session, isValid, isAdmin } = useSession();
  const needsPasskey = isAdmin && isValid && session?.user?.needsPasskey;

  return (
    <SyncStatusProvider>
      <div className="app-shell">
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <Sidebar />
        <div className="app-shell__column">
          <TopBar />
          <main id="main-content" className="app-main" tabIndex={-1}>
            {session && !isValid && (
              <Alert tone="warning" title="Your sign-in has expired" className="app-main__notice">
                You can keep recording on this device; <Link to="/login">sign in again</Link> to sync.
              </Alert>
            )}
            {needsPasskey && (
              <Alert
                tone="warning"
                title="Add a passkey to secure your administrator account"
                className="app-main__notice"
                action={<Button as={Link} to="/settings#passkeys" variant="secondary" size="sm">Add a passkey</Button>}
              >
                Until you do, anyone with your password can sign in as you.
              </Alert>
            )}
            <Outlet />
          </main>
        </div>
        <BottomNav />
      </div>
    </SyncStatusProvider>
  );
}

export default AppShell;
