import { useEffect, useState } from 'react';
import { getReviewFlags } from '../../services/api';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useResolvesConflicts } from '../conflicts/useServerConflictCount';

// The review page announces a checked flag so badges update straight away
export const FLAGS_CHANGED_EVENT = 'lishe:review-flags-changed';
const REFRESH_MS = 5 * 60 * 1000;

/**
 * Records flagged for review and not yet checked (#62), for programme officers (their
 * sub-county) and administrators while online. Shown as a navigation badge and on the
 * dashboard. 0 for school staff.
 */
export function useOpenFlagCount() {
  const isOnline = useOnlineStatus();
  const reviews = useResolvesConflicts();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!reviews || !isOnline) {
      setCount(0);
      return undefined;
    }
    let active = true;
    const load = () => getReviewFlags('open')
      .then((res) => { if (active) setCount(res.openCount || 0); })
      .catch(() => {});
    load();
    const timer = setInterval(load, REFRESH_MS);
    window.addEventListener(FLAGS_CHANGED_EVENT, load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener(FLAGS_CHANGED_EVENT, load);
    };
  }, [reviews, isOnline]);

  return count;
}
