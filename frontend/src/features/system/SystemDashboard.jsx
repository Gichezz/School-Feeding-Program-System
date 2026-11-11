import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Lock, Tablet, Users } from 'lucide-react';
import { Alert, Button, Card, PageHeader, StatCard } from '../../components/ui';
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
  const needsYou = data && (data.pendingDevices > 0 || data.lockedSignIns > 0);

  return (
    <>
      <PageHeader title="Dashboard" description="Accounts and school devices." />
      <div className="ui-stack">
        {!isOnline && <Alert tone="neutral" title="You are offline">Accounts and devices need a connection.</Alert>}
        {error && <Alert tone="danger" title="Could not load accounts and devices">{error}</Alert>}

        <div className="ui-grid ui-grid--4">
          <StatCard label="Devices waiting for approval" icon={Tablet} loading={loading}
            value={formatNumber(data?.pendingDevices)} hint="School devices set up but not yet approved" />
          <StatCard label="Approved devices" icon={Tablet} loading={loading}
            value={formatNumber(data?.approvedDevices)} hint="Can sign in and sync" />
          <StatCard label="Locked sign-ins" icon={Lock} loading={loading}
            value={formatNumber(data?.lockedSignIns)} hint="Teachers locked out after wrong PINs" />
          <StatCard label="Active accounts" icon={Users} loading={loading}
            value={formatNumber(data?.activeUsers)} hint="People who can sign in" />
        </div>

        {data && (
          <Card>
            <div className="dashboard__review">
              <KeyRound className="dashboard__attention-icon" aria-hidden="true" />
              <p className="dashboard__attention-description">
                {needsYou
                  ? 'Some school devices or sign-ins are waiting for you.'
                  : 'No device or sign-in is waiting for you.'}
                {data.withoutSecondFactor > 0 && ` ${data.withoutSecondFactor} administrator account${data.withoutSecondFactor === 1 ? ' has' : 's have'} no passkey or authenticator app yet.`}
              </p>
              <Button as={Link} to="/settings#devices" variant="secondary" size="sm">School devices</Button>
              <Button as={Link} to="/settings" variant="secondary" size="sm">Accounts</Button>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

export default SystemDashboard;
