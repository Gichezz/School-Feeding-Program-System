import { useCallback, useEffect, useState } from 'react';
import { Ban, CheckCircle2, Hourglass, LockOpen, Tablet, XCircle } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, FilterChips, LoadingRegion, SkeletonText, StatusLine, useToast } from '../../components/ui';
import { approveDevice, getDevices, resendApprovalEmail, revokeDevice, unlockDeviceUser } from '../../services/api';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { formatDate, formatRelativeTime } from '../../utils/format';

const STATUS = {
  pending: { tone: 'warning', label: 'Waiting for approval', icon: Hourglass },
  approved: { tone: 'success', label: 'Approved', icon: CheckCircle2 },
  revoked: { tone: 'neutral', label: 'Removed', icon: Ban },
  expired: { tone: 'neutral', label: 'Expired, not approved', icon: Ban },
};
// Waiting devices first: they are the administrator's work
const ORDER = { pending: 0, approved: 1, expired: 2, revoked: 3 };

/**
 * Settings → School devices, for administrators (#60). Staff can only sign in and sync
 * on approved devices; removing a device ends its sessions at once.
 */
function DevicesCard() {
  const isOnline = useOnlineStatus();
  const toast = useToast();
  const [devices, setDevices] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirmRevoke, setConfirmRevoke] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState({});

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      setDevices((await getDevices()).devices || []);
    } catch (err) {
      setDevices([]);
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => {
    if (isOnline) load();
  }, [isOnline, load]);

  const run = async (key, action, message) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      toast.show({ tone: 'success', ...message });
      setConfirmRevoke(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const pending = (devices || []).filter((d) => d.status === 'pending').length;
  const schools = [...new Set((devices || []).map((d) => d.schoolName).filter(Boolean))].sort();
  const shown = (devices || [])
    .filter((d) => (!filter.status || (filter.status === 'gone' ? ['revoked', 'expired'].includes(d.status) : d.status === filter.status))
      && (!filter.school || d.schoolName === filter.school))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (b.createdAt || '').localeCompare(a.createdAt || ''));

  return (
    <Card
      id="devices"
      title="School devices"
      description="Approve a school's tablet or phone before staff can sign in on it. Remove one that is lost or no longer used."
    >
      <div className="ui-stack">
        {!isOnline && <Alert tone="neutral" title="You are offline">Managing devices needs a connection.</Alert>}
        {loadError && <Alert tone="danger" title="Devices could not be loaded">{loadError}</Alert>}
        {error && <Alert tone="danger" title="Not done">{error}</Alert>}
        {pending > 0 && (
          <StatusLine icon={Hourglass} tone="warning">
            <strong>{pending === 1 ? '1 device is waiting for approval.' : `${pending} devices are waiting for approval.`}</strong>{' '}
            Approve a device only if you know it is the school's own device.
          </StatusLine>
        )}

        {isOnline && devices === null && <LoadingRegion label="Loading devices"><SkeletonText lines={3} /></LoadingRegion>}
        {devices?.length === 0 && !loadError && (
          <EmptyState
            compact
            icon={Tablet}
            title="No school devices yet"
            description="A device appears here for approval once staff set it up."
          />
        )}

        {devices?.length > 0 && (
          <FilterChips
            groups={[
              { key: 'status', label: 'Show', options: [{ value: 'pending', label: 'Waiting for approval' }, { value: 'approved', label: 'Approved' }, { value: 'gone', label: 'Removed or expired' }] },
              ...(schools.length > 1 ? [{ key: 'school', label: 'School', options: schools.map((name) => ({ value: name, label: name })) }] : []),
            ]}
            value={filter}
            onChange={setFilter}
            resultText={`${shown.length} of ${devices.length} devices`}
          />
        )}

        {devices?.length > 0 && (
          <ul className="devices__list">
            {shown.map((device) => (
              <li key={device.id} className="devices__item">
                <div className="devices__head">
                  <Tablet className="devices__icon" aria-hidden="true" />
                  <div className="devices__text">
                    <p className="devices__name">
                      {device.name}
                      <Badge tone={STATUS[device.status].tone} icon={STATUS[device.status].icon}>{STATUS[device.status].label}</Badge>
                    </p>
                    <p className="devices__meta">
                      {device.schoolName} · set up {formatDate(device.createdAt)}{device.enrolledBy && ` by ${device.enrolledBy}`}
                      {device.lastSeenAt && ` · last sign-in ${formatRelativeTime(device.lastSeenAt)}`}
                      {device.expiredAt && ` · expired ${formatDate(device.expiredAt)}`}
                    </p>
                  </div>
                </div>

                {device.staff.length > 0 && (
                  <ul className="devices__staff" aria-label={`Staff on ${device.name}`}>
                    {device.staff.map((person) => (
                      <li key={person.userId} className="devices__person">
                        <span>
                          {person.name}
                          {person.locked && <Badge tone="danger">Locked: too many wrong PINs</Badge>}
                          {device.status === 'approved' && person.approvalEmail === 'failed' && <Badge tone="warning">Approval email not sent</Badge>}
                        </span>
                        {device.status === 'approved' && person.approvalEmail === 'failed' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={busy === `${device.id}:email`}
                            disabled={!isOnline || Boolean(busy)}
                            onClick={() => run(`${device.id}:email`, () => resendApprovalEmail(device.id), { title: 'Approval email sent again', description: 'The device stays approved either way.' })}
                          >
                            Send again
                          </Button>
                        )}
                        {person.locked && device.status !== 'revoked' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={LockOpen}
                            loading={busy === `${device.id}:${person.userId}`}
                            disabled={!isOnline || Boolean(busy)}
                            onClick={() => run(`${device.id}:${person.userId}`, () => unlockDeviceUser(device.id, person.userId), { title: `${person.name} unlocked`, description: `They can sign in on ${device.name} again.` })}
                          >
                            Unlock
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {(device.status === 'pending' || device.status === 'approved') && (
                  confirmRevoke === device.id ? (
                    <Alert
                      tone="warning"
                      title={`Remove ${device.name}?`}
                      action={(
                        <div className="devices__actions">
                          <Button variant="danger" size="sm" loading={busy === device.id} onClick={() => run(device.id, () => revokeDevice(device.id), { title: `${device.name} removed`, description: 'Nobody can sign in on it any more.' })}>
                            Remove device
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => setConfirmRevoke(null)} disabled={Boolean(busy)}>Cancel</Button>
                        </div>
                      )}
                    >
                      Staff are signed out of it straight away and cannot sign in on it again. This cannot be undone.
                    </Alert>
                  ) : (
                    <div className="devices__actions">
                      {device.status === 'pending' && (
                        <Button
                          size="sm"
                          icon={CheckCircle2}
                          loading={busy === device.id}
                          disabled={!isOnline || Boolean(busy)}
                          onClick={() => run(device.id, () => approveDevice(device.id), { title: `${device.name} approved`, description: 'Staff can now sign in on it.' })}
                        >
                          Approve
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" icon={XCircle} disabled={!isOnline || Boolean(busy)} onClick={() => setConfirmRevoke(device.id)}>
                        Remove
                      </Button>
                    </div>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export default DevicesCard;
