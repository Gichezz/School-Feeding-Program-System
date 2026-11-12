import { useEffect, useState } from 'react';
import { checkDeviceApproval } from './deviceClient';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export const APPROVAL_CHECK_MS = 15 * 1000;
export const MAX_APPROVAL_CHECK_MS = 2 * 60 * 1000;

/**
 * How long to wait before the next check: 15 seconds after an answer, and twice as long
 * after each check that got no answer (a dropped connection, the server restarting), up
 * to 2 minutes, so a poor connection is not flooded with requests.
 */
export function nextCheckDelay(current, answered) {
  if (answered) return APPROVAL_CHECK_MS;
  return Math.min(current * 2, MAX_APPROVAL_CHECK_MS);
}

/**
 * The approval status of a device that is waiting for it, kept up to date.
 *
 * While the device is waiting, online and its screen is visible, it asks the server
 * whether it has been approved, and once more when the screen comes back into view. This
 * is application-specific polling, similar to the polling in the OAuth device
 * authorization grant (RFC 8628), not an implementation of that protocol. It stops when
 * the answer is no longer "pending" (approved or removed), when the device goes offline,
 * and when the screen showing it closes. The answer is only the device's status.
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
    let timer = null;
    let delay = APPROVAL_CHECK_MS;

    const schedule = () => {
      clearTimeout(timer);
      if (active) timer = setTimeout(check, delay);
    };
    async function check() {
      if (!active) return;
      if (document.visibilityState === 'hidden') {
        schedule();
        return;
      }
      let answered = false;
      try {
        const next = await checkDeviceApproval();
        answered = true;
        if (active && next) setStatus(next);
      } catch {
        // No answer this time: wait longer before asking again
      }
      delay = nextCheckDelay(delay, answered);
      schedule();
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };

    check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [identity, status, isOnline]);

  return status;
}
