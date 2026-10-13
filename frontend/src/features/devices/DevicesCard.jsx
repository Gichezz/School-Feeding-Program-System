import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, LockOpen, Tablet, XCircle } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, LoadingRegion, SkeletonText, useToast } from '../../components/ui';
import { approveDevice, getDevices, revokeDevice, unlockDeviceUser } from '../../services/api';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { formatDate, formatRelativeTime } from '../../utils/format';

const STATUS = {
  pending: { tone: 'warning', label: 'Waiting for approval' },
  approved: { tone: 'success', label: 'Approved' },
  revoked: { tone: 'neutral', label: 'Removed' },
};

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

  return (
    <Card
      id="devices"
      title="School devices"
      description="Staff record on the school's own tablets and phones. Approve a device before staff can sign in on it; remove one that is lost or no longer used."
    >
      <div className="ui-stack">
        {!isOnline && <Alert tone="neutral" title="You are offline">Managing devices needs a connection.</Alert>}
        {loadError && <Alert tone="danger" title="Devices could not be loaded">{loadError}</Alert>}
        {error && <Alert tone="danger" title="Not done">{error}</Alert>}
        {pending > 0 && (
          <Alert tone="warning" title={pending === 1 ? '1 device is waiting for approval' : `${pending} devices are waiting for approval`}>
            Approve a device only if you know it is the school's own device.
          </Alert>
        )}

        {isOnline && devices === null && <LoadingRegion label="Loading devices"><SkeletonText lines={3} /></LoadingRegion>}
        {devices?.length === 0 && !loadError && (
          <EmptyState
            compact
            icon={Tablet}
            title="No school devices yet"
            description="Staff set up a device from the sign-in page with their activation code. It then appears here for approval."
          />
        )}

        {devices?.length > 0 && (
          <ul className="devices__list">
            {devices.map((device) => (
              <li key={device.id} className="devices__item">
                <div className="devices__head">
                  <Tablet className="devices__icon" aria-hidden="true" />
                  <div className="devices__text">
                    <p className="devices__name">
                      {device.name}
                      <Badge tone={STATUS[device.status].tone}>{STATUS[device.status].label}</Badge>
                    </p>
                    <p className="devices__meta">
                      {device.schoolName} · set up {formatDate(device.createdAt)}{device.enrolledBy && ` by ${device.enrolledBy}`}
                      {device.lastSeenAt && ` · last sign-in ${formatRelativeTime(device.lastSeenAt)}`}
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
                        </span>
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

                {device.status !== 'revoked' && (
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
                      Staff are signed out on it straight away and cannot sign in on it again. Records still waiting on
                      it stay on the device. This cannot be undone; a found device is set up again as new.
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
