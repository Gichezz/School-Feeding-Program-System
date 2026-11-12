import { Link, Outlet, useLocation } from 'react-router-dom';
import { Alert, Button } from '../ui';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import BottomNav from './BottomNav';
import { SyncStatusProvider } from '../../hooks/useSyncStatus';
import { DataFreshnessProvider } from '../../hooks/useDataFreshness';
import { useSession } from '../../hooks/useSession';

// On a school device the sign-in banner shows only where records are entered or sent;
// everywhere else the top bar already says that sending is paused
const STAFF_BANNER_PAGES = ['/today', '/sync'];

/**
 * The one banner that asks someone to act before their work can count (tier 1 of the
 * alert tiers). Work that is merely waiting shows as counts in the navigation and on
 * dashboards, and the result of an action shows as a toast, so pages never stack banners.
 */
function BlockingBanner() {
  const { session, isValid, isAdmin } = useSession();
  const { pathname } = useLocation();
  const isStaff = session?.user?.role === 'school_staff';

  if (session && !isValid) {
    // Officers and administrators can do nothing without a sign-in, so they see it everywhere
    if (isStaff && !STAFF_BANNER_PAGES.includes(pathname)) return null;
    if (session.endedReason === 'deviceRevoked') {
      return (
        <Alert tone="warning" title="This device can no longer send records" className="app-main__notice"
          action={<Button as={Link} to="/activate" variant="secondary" size="sm">Set up again</Button>}>
          Your records are still saved here.
        </Alert>
      );
    }
    return (
      <Alert tone="warning" title="Your sign-in has expired" className="app-main__notice"
        action={<Button as={Link} to="/login" variant="secondary" size="sm">Sign in again</Button>}>
        {isStaff ? 'You can keep recording. Sign in again to send your records.' : 'Sign in again to continue.'}
      </Alert>
    );
  }

  const needsPasskey = isAdmin && isValid && session?.user?.needsPasskey;
  if (needsPasskey && (pathname === '/' || pathname === '/settings')) {
    return (
      <Alert
        tone="warning"
        title="Secure your account with a passkey or authenticator app"
        className="app-main__notice"
        action={<Button as={Link} to="/settings#passkeys" variant="secondary" size="sm">Add a passkey</Button>}
      >
        Until you do, anyone with your password can sign in as you.
      </Alert>
    );
  }
  return null;
}

/**
 * Signed-in app frame: sidebar or labelled rail (tablet and desktop) or bottom tabs
 * (mobile), the top bar, and the page content.
 */
function AppShell() {
  return (
    <SyncStatusProvider>
      <DataFreshnessProvider>
        <div className="app-shell">
          <a className="skip-link" href="#main-content">Skip to main content</a>
          <Sidebar />
          <div className="app-shell__column">
            <TopBar />
            <main id="main-content" className="app-main" tabIndex={-1}>
              <BlockingBanner />
              <Outlet />
            </main>
          </div>
          <BottomNav />
        </div>
      </DataFreshnessProvider>
    </SyncStatusProvider>
  );
}

export default AppShell;
