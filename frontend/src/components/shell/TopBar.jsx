import { useEffect, useState } from 'react';
import { CloudOff, MapPin, RefreshCw, School } from 'lucide-react';
import { SyncStatusBar } from '../ui';
import LisheLogo from './LisheLogo';
import UserMenu from './UserMenu';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { useSession } from '../../hooks/useSession';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useDataFreshness } from '../../hooks/useDataFreshness';
import { liveQuery } from 'dexie';
import db from '../../db/database';
import { cacheSchools, getCachedSchools } from '../../services/localDb';
import { getSchools } from '../../services/api';
import { formatTime } from '../../utils/format';

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

/** The feeding teacher's top bar: the school and how its records are syncing. */
function SchoolBar() {
  const sync = useSyncStatus();
  const schoolName = useSchoolName();
  const barProps = {
    state: sync.state,
    pausedReason: sync.pausedReason,
    pendingCount: sync.pendingCount,
    progress: sync.progress,
    lastSyncedAt: sync.lastSyncedAt,
    failure: sync.failure,
    conflictCount: sync.unresolvedConflicts,
    signedInOffline: sync.signedInOffline,
    canSync: sync.canSync,
  };

  return (
    <>
      {schoolName && (
        <p className="app-topbar__scope">
          <School className="app-topbar__scope-icon" aria-hidden="true" />
          <span className="app-topbar__scope-text">{schoolName}</span>
        </p>
      )}
      <div className="app-topbar__status app-topbar__status--bar">
        <SyncStatusBar {...barProps} onSyncNow={sync.syncNow} />
      </div>
      <div className="app-topbar__status app-topbar__status--pill">
        <SyncStatusBar {...barProps} variant="pill" />
      </div>
    </>
  );
}

/**
 * The programme officer's top bar: whose schools these are, and how current the
 * figures on screen are. Officers record nothing on this device, so there is no sync.
 */
function OversightBar() {
  const isOnline = useOnlineStatus();
  const { loadedAt, scope, refresh } = useDataFreshness();

  return (
    <>
      {scope && (
        <p className="app-topbar__scope">
          <MapPin className="app-topbar__scope-icon" aria-hidden="true" />
          <span className="app-topbar__scope-text">{scope}</span>
        </p>
      )}
      {(loadedAt || !isOnline) && (
        <div className="app-topbar__status app-topbar__freshness" role="status" aria-live="polite">
          {isOnline ? (
            <>
              <span className="app-topbar__freshness-text app-topbar__freshness-word">Data as of {formatTime(loadedAt)}</span>
              <span className="app-topbar__freshness-text app-topbar__freshness-word--short">As of {formatTime(loadedAt)}</span>
              <button type="button" className="ui-button ui-button--ghost ui-button--sm" onClick={refresh}>
                <RefreshCw className="ui-button__icon" aria-hidden="true" />
                Refresh
              </button>
            </>
          ) : (
            <span className="app-topbar__freshness-text app-topbar__freshness-text--offline">
              <CloudOff className="app-topbar__scope-icon" aria-hidden="true" />
              {loadedAt ? `Offline – showing data from ${formatTime(loadedAt)}` : 'Offline'}
            </span>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Top bar on every screen size: the Lishe wordmark (mobile), what this person looks
 * after (their school, or their sub-county), its status and the user menu.
 * Administrators manage accounts and devices only, so theirs has neither.
 */
function TopBar() {
  const { user } = useSession();
  const role = user?.role;

  return (
    <header className={`app-topbar app-topbar--${role || 'none'}`}>
      <div className="app-topbar__identity">
        <LisheLogo className="app-topbar__logo" />
      </div>
      {role === 'school_staff' && <SchoolBar />}
      {role === 'programme_officer' && <OversightBar />}
      <UserMenu />
    </header>
  );
}

export default TopBar;
