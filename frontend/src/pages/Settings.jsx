import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { useLocation } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { APP_NAME, Button, Card, PageHeader, SummaryList } from '../components/ui';
import LisheLogo from '../components/shell/LisheLogo';
import ChangePasswordCard from '../features/users/ChangePasswordCard';
import PasskeysCard from '../features/passkeys/PasskeysCard';
import DevicesCard from '../features/devices/DevicesCard';
import { getDeviceIdentity } from '../features/devices/deviceIdentity';
import UsersSection from '../features/users/UsersSection';
import { ROLE_LABELS, useSignOut } from '../components/shell/UserMenu';
import db, { getOrCreateClientId } from '../db/database';
import { useSession } from '../hooks/useSession';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { formatDateTime, formatNumber } from '../utils/format';

/**
 * Your account (including changing your password), what is stored on this device,
 * and, for administrators, the Users section for managing accounts.
 */
function Settings() {
  const { user, session, isValid, isAdmin } = useSession();
  const isOnline = useOnlineStatus();
  const signOut = useSignOut();
  const { hash } = useLocation();
  const [clientId, setClientId] = useState('');
  const [device, setDevice] = useState(null);
  const [schoolDevice, setSchoolDevice] = useState(null);

  useEffect(() => {
    getOrCreateClientId().then(setClientId).catch(() => setClientId(''));
    getDeviceIdentity().then(setSchoolDevice);
    const subscription = liveQuery(async () => ({
      attendance: await db.attendance.count(),
      meals: await db.mealDistribution.count(),
      waiting: await db.syncQueue.where('status').equals('pending').count(),
      forecasts: await db.forecasts.count(),
    })).subscribe({ next: setDevice, error: () => setDevice(null) });
    return () => subscription.unsubscribe();
  }, []);

  // Links such as /settings#devices open at that card. The cards above it load their
  // data after the first render and push it down, so keep it in view while the page is
  // still growing (up to 3 seconds), unless the user starts scrolling or typing.
  useEffect(() => {
    if (!hash) return undefined;
    const scroll = () => document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start', behavior: 'instant' });
    const observer = new ResizeObserver(scroll);
    const stop = () => observer.disconnect();
    const userEvents = ['wheel', 'touchstart', 'keydown', 'mousedown'];
    scroll();
    // Each card, not just the page: one card growing while another shrinks leaves the
    // page height unchanged but still moves the target
    document.querySelectorAll('#main-content .ui-card').forEach((card) => observer.observe(card));
    userEvents.forEach((type) => window.addEventListener(type, stop, { once: true, passive: true }));
    const timer = setTimeout(stop, 3000);
    return () => {
      stop();
      clearTimeout(timer);
      userEvents.forEach((type) => window.removeEventListener(type, stop));
    };
  }, [hash]);

  const count = (n) => (device ? formatNumber(n) : '…');

  return (
    <>
      <PageHeader title="Settings" description={isAdmin ? 'Your account, user accounts and what is stored on this device.' : 'Your account and what is stored on this device.'} />

      <div className="ui-stack">
        <Card
          title="Your account"
          actions={<Button variant="secondary" icon={LogOut} onClick={signOut}>Sign out</Button>}
        >
          <SummaryList
            rows={[
              { key: 'name', label: 'Name', value: user?.name || '–' },
              { key: 'email', label: 'Email', value: user?.email || '–' },
              { key: 'role', label: 'Role', value: ROLE_LABELS[user?.role] || user?.role || '–' },
              { key: 'expires', label: 'Signed in until', value: isValid ? formatDateTime(session.expiresAt) : 'Expired. Sign in again to sync' },
            ]}
          />
        </Card>

        {isAdmin && <PasskeysCard />}

        <ChangePasswordCard />

        {isAdmin && <UsersSection />}

        {isAdmin && <DevicesCard />}

        <Card title="This device" description="Records are saved here first, so they are safe without a connection.">
          <SummaryList
            rows={[
              { key: 'connection', label: 'Connection', value: isOnline ? 'Online' : 'Offline' },
              {
                key: 'school-device',
                label: 'School device',
                value: schoolDevice
                  ? `${schoolDevice.name} (${schoolDevice.status === 'approved' ? 'approved' : 'waiting for approval'})`
                  : 'Not set up for staff sign-in',
              },
              { key: 'attendance', label: 'Attendance records', value: count(device?.attendance) },
              { key: 'meals', label: 'Meal records', value: count(device?.meals) },
              { key: 'waiting', label: 'Changes waiting to sync', value: count(device?.waiting) },
              { key: 'forecasts', label: 'Forecasts saved for offline use', value: count(device?.forecasts) },
              { key: 'device', label: 'Device ID', value: <code className="settings__code">{clientId || '–'}</code> },
            ]}
          />
          <p className="settings__note">
            Signing out keeps these records on the device; they sync the next time someone signs in here.
          </p>
        </Card>

        <Card title={`About ${APP_NAME}`}>
          <div className="settings__about">
            <LisheLogo withTagline />
            <p className="settings__note">
              {APP_NAME} records daily school attendance and meals, works without a connection, and syncs with the
              programme&apos;s central server when one is available.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}

export default Settings;
