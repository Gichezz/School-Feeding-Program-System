import { useEffect, useState } from 'react';
import { CloudOff, KeyRound, Lock, Tablet } from 'lucide-react';
import { Alert, Card, PageHeader, StatusLine, WorkQueue } from '../../components/ui';
import { getDevices, getUsers } from '../../services/api';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { formatNumber } from '../../utils/format';

/** Counts for the system administrator's start page, from the device and account lists. */
export function systemSummary(devices, users) {
  const live = devices.filter((d) => d.status !== 'revoked');
  return {
    pendingDevices: devices.filter((d) => d.status === 'pending').length,
    approvedDevices: devices.filter((d) => d.status === 'approved').length,
    lockedSignIns: live.reduce((n, d) => n + (d.staff || []).filter((p) => p.locked).length, 0),
    activeUsers: users.filter((u) => u.isActive).length,
    // Administrator accounts without a passkey or an authenticator app
    withoutSecondFactor: users.filter((u) => u.isActive && u.role === 'admin' && !Number(u.passkeyCount) && !u.totpEnabled).length,
  };
}

/**
 * The system administrator's start page. They run accounts, devices and configuration
 * and see no school records (least privilege), so this shows only what needs them.
 */
function SystemDashboard() {
  const isOnline = useOnlineStatus();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOnline) return undefined;
    let active = true;
    Promise.all([getDevices(), getUsers()])
      .then(([d, u]) => { if (active) setData(systemSummary(d.devices || [], u.users || [])); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [isOnline]);

  const loading = isOnline && !data && !error;
  const n = (count, one, many) => `${formatNumber(count)} ${count === 1 ? one : many}`;

  const items = data ? [
    {
      key: 'devices', icon: Tablet, to: '/devices',
      ...(data.pendingDevices > 0
        ? { title: n(data.pendingDevices, 'device waiting for approval', 'devices waiting for approval'), description: 'Approve only a school’s own device.' }
        : { title: 'No devices waiting for approval', done: true }),
    },
    {
      key: 'locked', icon: Lock, to: '/devices',
      ...(data.lockedSignIns > 0
        ? { title: n(data.lockedSignIns, 'teacher locked out', 'teachers locked out'), description: 'Too many wrong PINs on a school device.' }
        : { title: 'No locked sign-ins', done: true }),
    },
    {
      key: 'secondFactor', icon: KeyRound, to: '/users',
      ...(data.withoutSecondFactor > 0
        ? { title: n(data.withoutSecondFactor, 'administrator without a passkey or authenticator app', 'administrators without a passkey or authenticator app'), description: 'Anyone with their password can sign in as them.' }
        : { title: 'Every administrator has a passkey or authenticator app', done: true }),
    },
  ] : [];

  return (
    <div data-density="compact">
      <PageHeader title="Dashboard" description="Accounts and school devices." />
      <div className="ui-stack">
        {!isOnline && <StatusLine icon={CloudOff}>Offline. Accounts and devices need a connection.</StatusLine>}
        {error && <Alert tone="danger" title="Could not load accounts and devices">{error}</Alert>}

        <Card title="To do">
          <WorkQueue items={items} loading={loading} label="Work waiting for you" />
        </Card>

        {data && (
          <Card title="Accounts and devices">
            <dl className="dashboard__snapshot">
              <div className="dashboard__figure">
                <dt>Active accounts</dt>
                <dd className="tabular-nums">{formatNumber(data.activeUsers)}</dd>
              </div>
              <div className="dashboard__figure">
                <dt>Approved school devices</dt>
                <dd className="tabular-nums">{formatNumber(data.approvedDevices)}</dd>
              </div>
            </dl>
          </Card>
        )}
      </div>
    </div>
  );
}

export default SystemDashboard;
