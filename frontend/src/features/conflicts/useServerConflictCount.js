import { useEffect, useState } from 'react';
import { getConflicts } from '../../services/api';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useSession } from '../../hooks/useSession';

// The conflicts page announces a resolved conflict so badges update straight away
export const CONFLICTS_CHANGED_EVENT = 'lishe:conflicts-changed';
const REFRESH_MS = 5 * 60 * 1000;

/** Programme officers and administrators: they resolve conflicts from the server's list. */
export function useResolvesConflicts() {
  const { isAdmin, user } = useSession();
  return isAdmin || user?.role === 'programme_officer';
}

/**
 * Unresolved conflicts on the server for the schools this person oversees, while online;
 * null for school staff, whose badge counts this device's conflicts instead.
 */
export function useServerConflictCount() {
  const isOnline = useOnlineStatus();
  const resolves = useResolvesConflicts();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!resolves || !isOnline) {
      setCount(0);
      return undefined;
    }
    let active = true;
    const load = () => getConflicts({ status: 'unresolved' })
      .then((res) => { if (active) setCount((res.conflicts || []).length); })
      .catch(() => {});
    load();
    const timer = setInterval(load, REFRESH_MS);
    window.addEventListener(CONFLICTS_CHANGED_EVENT, load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener(CONFLICTS_CHANGED_EVENT, load);
    };
  }, [resolves, isOnline]);

  return resolves ? count : null;
}
