import { Link } from 'react-router-dom';
import { CheckCircle2, CloudOff, Hourglass, PauseCircle, RefreshCw, RotateCw } from 'lucide-react';
import Button from './Button';
import { formatNumber, formatRelativeTime } from '../../utils/format';

// What to do when sending is paused, and where to do it
const PAUSED = {
  signIn: { title: 'Sync paused – sign in again', fix: 'Sign in again', to: '/login' },
  deviceRemoved: { title: 'Sync paused – set this device up again', fix: 'Set up again', to: '/activate' },
};

/**
 * Sync state at a glance, always as an icon and words. Being offline is normal, so
 * it is calm (grey), never alarming.
 *
 * state: 'offline' | 'paused' | 'syncing' | 'conflict' | 'failed' | 'synced'
 * pausedReason: 'signIn' | 'deviceRemoved' when state is 'paused'
 * conflictCount: records changed here and on the server, waiting for the officer
 * progress: 0–100 while syncing
 * failure: { what, why, fix } when failed
 * signedInOffline: signed in with a PIN while offline
 * variant: 'compact' (top bar), 'pill' (top bar on phones) or 'expanded' (Sync page)
 */
function SyncStatusBar({
  state,
  pausedReason,
  pendingCount = 0,
  progress = 0,
  lastSyncedAt,
  failure,
  conflictCount = 0,
  signedInOffline = false,
  onSyncNow,
  canSync = true,
  variant = 'compact',
}) {
  const pending = pendingCount === 1 ? '1 change waiting to send' : `${formatNumber(pendingCount)} changes waiting to send`;
  const lastSynced = lastSyncedAt ? `Last sent ${formatRelativeTime(lastSyncedAt)}` : 'Nothing sent yet';
  const paused = PAUSED[pausedReason] || PAUSED.signIn;

  const content = {
    offline: {
      Icon: CloudOff,
      title: 'Offline – saved on this device',
      detail: [signedInOffline && 'Signed in offline.', pendingCount > 0 ? `${pending}.` : null, 'Lishe sends them when you are back online.']
        .filter(Boolean).join(' '),
    },
    paused: {
      Icon: PauseCircle,
      title: paused.title,
      detail: pendingCount > 0 ? `${pending}. They are safe on this device.` : 'Your records are safe on this device.',
    },
    syncing: {
      Icon: RefreshCw,
      title: `Sending… ${Math.round(progress)}%`,
      detail: pendingCount > 0 ? pending : 'Sending your changes',
    },
    synced: {
      Icon: CheckCircle2,
      title: pendingCount > 0 ? pending : 'Up to date',
      detail: lastSyncedAt || pendingCount > 0 ? lastSynced : 'Nothing waiting to send',
    },
    conflict: {
      Icon: Hourglass,
      title: conflictCount === 1 ? '1 record waiting for your officer' : `${formatNumber(conflictCount)} records waiting for your officer`,
      detail: pendingCount > 0 ? pending : 'It was changed on another device too. You don’t need to do anything.',
    },
    failed: {
      Icon: RotateCw,
      title: failure?.what || 'Some changes not sent – will retry',
      detail: pendingCount > 0 ? pending : lastSynced,
    },
  }[state];
  const { Icon } = content;
  const syncDisabled = state === 'offline' || state === 'paused' || state === 'syncing' || !canSync;
  const disabledReason = state === 'offline'
    ? 'Available when you are back online'
    : state === 'paused' ? paused.title : undefined;

  // Narrow screens: icon, short label and pending count, linking to the Sync page
  if (variant === 'pill') {
    const short = {
      offline: 'Offline',
      paused: 'Paused',
      syncing: `${Math.round(progress)}%`,
      synced: 'Up to date',
      conflict: 'Waiting',
      failed: 'Not sent',
    }[state];
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
          <progress className="ui-sync__progress" max="100" value={progress} aria-label="Sending progress" />
        )}
        {state === 'failed' && variant === 'expanded' && failure && (
          <dl className="ui-sync__failure">
            {failure.why && (<><dt>Why</dt><dd>{failure.why}</dd></>)}
            {failure.fix && (<><dt>How to fix it</dt><dd>{failure.fix}</dd></>)}
          </dl>
        )}
      </div>
      {state === 'paused' ? (
        <Button as={Link} to={paused.to} variant={variant === 'expanded' ? 'primary' : 'secondary'} size={variant === 'expanded' ? 'md' : 'sm'}>
          {paused.fix}
        </Button>
      ) : onSyncNow && (
        <Button
          variant={variant === 'expanded' ? 'primary' : 'secondary'}
          size={variant === 'expanded' ? 'md' : 'sm'}
          icon={RefreshCw}
          onClick={onSyncNow}
          disabled={syncDisabled}
          title={disabledReason}
        >
          Sync now
        </Button>
      )}
    </div>
  );
}

export default SyncStatusBar;
