import { useEffect, useState } from 'react';
import { getConflicts, getHeldRecords } from '../../services/api';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useSession } from '../../hooks/useSession';

// The conflicts page announces a resolved conflict so badges update straight away
export const CONFLICTS_CHANGED_EVENT = 'lishe:conflicts-changed';
const REFRESH_MS = 5 * 60 * 1000;

/** Programme officers resolve conflicts from the server's list. System administrators see no school records. */
export function useResolvesConflicts() {
  const { user } = useSession();
  return user?.role === 'programme_officer';
}

/**
 * Decisions waiting on the server for the schools this person oversees, while online:
 * unresolved conflicts and held records. null for school staff, whose badge counts this
 * device's conflicts instead.
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
    const load = () => Promise.all([getConflicts({ status: 'unresolved' }), getHeldRecords().catch(() => ({ held: [] }))])
      .then(([conflicts, held]) => { if (active) setCount((conflicts.conflicts || []).length + (held.held || []).length); })
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
