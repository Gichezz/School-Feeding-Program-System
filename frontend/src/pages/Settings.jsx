import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { LogOut } from 'lucide-react';
import { APP_NAME, Button, Card, PageHeader, SummaryList } from '../components/ui';
import LisheLogo from '../components/shell/LisheLogo';
import { ROLE_LABELS, useSignOut } from '../components/shell/UserMenu';
import db, { getOrCreateClientId } from '../db/database';
import { useSession } from '../hooks/useSession';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { formatDateTime, formatNumber } from '../utils/format';

/**
 * Account and device information. Read-only apart from signing out.
 */
function Settings() {
  const { user, session, isValid } = useSession();
  const isOnline = useOnlineStatus();
  const signOut = useSignOut();
  const [clientId, setClientId] = useState('');
  const [device, setDevice] = useState(null);

  useEffect(() => {
    getOrCreateClientId().then(setClientId).catch(() => setClientId(''));
    const subscription = liveQuery(async () => ({
      attendance: await db.attendance.count(),
      meals: await db.mealDistribution.count(),
      waiting: await db.syncQueue.where('status').equals('pending').count(),
      forecasts: await db.forecasts.count(),
    })).subscribe({ next: setDevice, error: () => setDevice(null) });
    return () => subscription.unsubscribe();
  }, []);

  const count = (n) => (device ? formatNumber(n) : '…');

  return (
    <>
      <PageHeader title="Settings" description="Your account and what is stored on this device." />

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

        <Card title="This device" description="Records are saved here first, so they are safe without a connection.">
          <SummaryList
            rows={[
              { key: 'connection', label: 'Connection', value: isOnline ? 'Online' : 'Offline' },
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
