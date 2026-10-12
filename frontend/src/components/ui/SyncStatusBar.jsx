import { Link } from 'react-router-dom';
import { CheckCircle2, CloudOff, RefreshCw, AlertTriangle } from 'lucide-react';
import Button from './Button';
import { formatNumber, formatRelativeTime } from '../../utils/format';

/**
 * Sync state at a glance. Being offline is normal, so it is calm (grey), never alarming.
 *
 * state: 'offline' | 'syncing' | 'synced' | 'failed'
 * progress: 0–100 while syncing
 * failure: { what, why, fix } when failed
 * variant: 'compact' (top bar), 'pill' (top bar on phones) or 'expanded' (Sync Status page)
 */
function SyncStatusBar({
  state,
  pendingCount = 0,
  progress = 0,
  lastSyncedAt,
  failure,
  onSyncNow,
  canSync = true,
  variant = 'compact',
}) {
  const pending = pendingCount === 1 ? '1 change waiting' : `${formatNumber(pendingCount)} changes waiting`;
  const lastSynced = lastSyncedAt ? `Last synced ${formatRelativeTime(lastSyncedAt)}` : 'Not synced yet';

  const content = {
    offline: {
      Icon: CloudOff,
      title: 'Offline – your work is saved on this device',
      detail: pendingCount > 0 ? `${pending}. Lishe will sync when you are back online.` : 'Lishe will sync when you are back online.',
    },
    syncing: {
      Icon: RefreshCw,
      title: `Syncing… ${Math.round(progress)}%`,
      detail: pendingCount > 0 ? `${pending}` : 'Sending your changes',
    },
    synced: {
      Icon: CheckCircle2,
      title: pendingCount > 0 ? pending : lastSyncedAt ? 'All changes synced' : 'Up to date',
      detail: lastSyncedAt || pendingCount > 0 ? lastSynced : 'Nothing waiting to sync',
    },
    failed: {
      Icon: AlertTriangle,
      title: failure?.what || 'Some changes did not sync',
      detail: pendingCount > 0 ? pending : lastSynced,
    },
  }[state];
  const { Icon } = content;
  const syncDisabled = state === 'offline' || state === 'syncing' || !canSync;

  // Narrow screens: icon, short label and pending count, linking to the Sync page
  if (variant === 'pill') {
    const short = { offline: 'Offline', syncing: `${Math.round(progress)}%`, synced: lastSyncedAt ? 'Synced' : 'Up to date', failed: 'Sync issue' }[state];
    return (
      <Link to="/sync" className={`ui-sync-pill ui-sync--${state}`} aria-label={`${content.title}. ${content.detail}`}>
        <Icon className="ui-sync__icon" aria-hidden="true" />
        <span className="ui-sync-pill__label">{short}</span>
        {pendingCount > 0 && <span className="ui-sync-pill__count">{formatNumber(pendingCount)}</span>}
      </Link>
    );
  }

  return (
    <div className={`ui-sync ui-sync--${state} ui-sync--${variant}`} role="status" aria-live="polite">
      <Icon className="ui-sync__icon" aria-hidden="true" />
      <div className="ui-sync__text">
        <p className="ui-sync__title">{content.title}</p>
        <p className="ui-sync__detail">{content.detail}</p>
        {state === 'syncing' && (
          <progress className="ui-sync__progress" max="100" value={progress} aria-label="Sync progress" />
        )}
        {state === 'failed' && variant === 'expanded' && failure && (
          <dl className="ui-sync__failure">
            {failure.why && (<><dt>Why</dt><dd>{failure.why}</dd></>)}
            {failure.fix && (<><dt>How to fix it</dt><dd>{failure.fix}</dd></>)}
          </dl>
        )}
      </div>
      {onSyncNow && (
        <Button
          variant={variant === 'expanded' ? 'primary' : 'secondary'}
          size={variant === 'expanded' ? 'md' : 'sm'}
          icon={RefreshCw}
          onClick={onSyncNow}
          disabled={syncDisabled}
          title={state === 'offline' ? 'Available when you are back online' : undefined}
        >
          Sync now
        </Button>
      )}
    </div>
  );
}

export default SyncStatusBar;
