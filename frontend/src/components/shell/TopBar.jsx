import { useEffect, useState } from 'react';
import { School } from 'lucide-react';
import { SyncStatusBar } from '../ui';
import LisheLogo from './LisheLogo';
import UserMenu from './UserMenu';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { liveQuery } from 'dexie';
import db from '../../db/database';
import { cacheSchools, getCachedSchools } from '../../services/localDb';
import { getSchools } from '../../services/api';

/**
 * Name of the school this device records for. Follows the offline school cache;
 * if the cache is empty and the device is online, fills it once from the server.
 */
function useSchoolName() {
  const [name, setName] = useState('');
  useEffect(() => {
    const subscription = liveQuery(() => db.schools.toArray()).subscribe({
      next: (schools) => setName(schools[0]?.name || ''),
      error: () => {},
    });
    getCachedSchools()
      .then((cached) => (cached.length ? null : getSchools().then((res) => cacheSchools(res.schools || []))))
      .catch(() => {});
    return () => subscription.unsubscribe();
  }, []);
  return name;
}

/**
 * Top bar on every screen size: the Lishe wordmark (mobile) or school name
 * (tablet and desktop), the sync status and the user menu.
 */
function TopBar() {
  const sync = useSyncStatus();
  const schoolName = useSchoolName();
  const barProps = {
    state: sync.state,
    pendingCount: sync.pendingCount,
    progress: sync.progress,
    lastSyncedAt: sync.lastSyncedAt,
    failure: sync.failure,
    canSync: sync.canSync,
  };

  return (
    <header className="app-topbar">
      <div className="app-topbar__identity">
        <LisheLogo className="app-topbar__logo" />
        {schoolName && (
          <p className="app-topbar__school">
            <School className="app-topbar__school-icon" aria-hidden="true" />
            {schoolName}
          </p>
        )}
      </div>
      <div className="app-topbar__sync app-topbar__sync--bar">
        <SyncStatusBar {...barProps} onSyncNow={sync.syncNow} />
      </div>
      <div className="app-topbar__sync app-topbar__sync--pill">
        <SyncStatusBar {...barProps} variant="pill" />
      </div>
      <UserMenu />
    </header>
  );
}

export default TopBar;
