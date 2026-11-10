import { useEffect, useState } from 'react';
import { checkDeviceApproval } from './deviceClient';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export const APPROVAL_CHECK_MS = 15 * 1000;

/**
 * The approval status of a device that is waiting for it, kept up to date.
 *
 * While the device is waiting, online and its screen is visible, it asks the server
 * every 15 seconds whether it has been approved, and once more when the screen comes
 * back into view, as devices waiting for a sign-in to be approved elsewhere do (the
 * OAuth device flow). It stops as soon as the answer is no longer "pending".
 *
 * identity: this device's stored identity, or null. Returns 'pending', 'approved',
 * 'revoked' or null (not a school device).
 */
export function useDeviceApproval(identity) {
  const isOnline = useOnlineStatus();
  const [status, setStatus] = useState(identity?.status ?? null);

  useEffect(() => setStatus(identity?.status ?? null), [identity]);

  useEffect(() => {
    if (!identity || status !== 'pending' || !isOnline) return undefined;
    let active = true;
    const check = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const next = await checkDeviceApproval();
        if (active && next) setStatus(next);
      } catch {
        // No answer this time (a dropped connection, the server restarting): ask again next time
      }
    };
    check();
    const timer = setInterval(check, APPROVAL_CHECK_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [identity, status, isOnline]);

  return status;
}
