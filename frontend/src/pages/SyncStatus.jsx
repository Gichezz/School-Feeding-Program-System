import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import {
  Card,
  DataTable,
  PageHeader,
  RecordStatus,
  RECORD_STATES,
  SyncStatusBar,
  recordStateFor,
  useToast,
} from '../components/ui';
import db from '../db/database';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { formatDate, formatDateTime, formatNumber } from '../utils/format';

const RECENT_LIMIT = 20;

// What each kind of queued change is called, and the date it is for
const RECORD_KINDS = {
  attendance: ['Attendance', 'attendanceDate'],
  mealDistribution: ['Meals', 'distributionDate'],
  dailyFeeding: ['Feeding', 'feedingDate'],
  enrolment: ['Enrolment', null],
  stockMovement: ['Stock entry', 'movementDate'],
  stockCount: ['Stock count', 'countDate'],
};

// Why the server did not count a record, in plain words
const HELD_REASONS = {
  duplicate_delivery: 'delivery note already recorded',
  user_deactivated: 'the account that saved it was closed',
  password_reset: 'saved before a password reset',
  device_revoked: 'this device was removed',
};

/** One queued change in display form. */
function toRow(op) {
  const [kind, dateField] = RECORD_KINDS[op.entityType] || ['Record', null];
  const date = dateField ? op.payload?.[dateField] : op.payload?.class;
  return {
    id: op.id,
    record: `${kind}${date ? ` · ${dateField ? formatDate(date) : date}` : ''}`,
    change: op.operation === 'update' ? 'Edited' : 'New record',
    state: recordStateFor(op.status, { errorMessage: op.errorMessage }),
    heldReason: op.status === 'held' ? HELD_REASONS[op.heldReason] : undefined,
    savedAt: formatDateTime(op.createdAt),
    capturedBy: op.capturedByName || '–',
  };
}

const COLUMNS = [
  { key: 'record', header: 'Record', primary: true },
  { key: 'state', header: 'Status', render: (row) => <RecordStatus state={row.state} reason={row.heldReason} /> },
  { key: 'change', header: 'Change' },
  { key: 'capturedBy', header: 'Saved by' },
  { key: 'savedAt', header: 'Saved on device' },
];

// The order the counts are listed in: what needs attention first
const COUNT_ORDER = ['waiting', 'hold', 'retry', 'local', 'sent'];
const COUNT_MEANING = {
  local: 'not sent yet',
  sent: 'on the server',
  waiting: 'changed on another device too; your officer chooses which to keep',
  hold: 'not counted until your officer clears them',
  retry: 'Lishe tries again by itself',
};

/**
 * What is saved on this device and what has been sent, in the same five words used
 * on every list, and Sync now. Reads the local sync queue only; syncing is unchanged.
 */
function SyncStatus() {
  const sync = useSyncStatus();
  const toast = useToast();
  const [operations, setOperations] = useState(null);

  // Live view of the queue, so the page updates while a sync runs
  useEffect(() => {
    const subscription = liveQuery(() => db.syncQueue.toArray()).subscribe({
      next: setOperations,
      error: () => setOperations([]),
    });
    return () => subscription.unsubscribe();
  }, []);

  const syncNow = async () => {
    const result = await sync.syncNow();
    if (!result) return;
    toast.show(result.success
      ? { tone: 'success', title: 'Sending finished', description: result.message }
      : { tone: 'warning', title: 'Sending did not finish', description: result.message || 'Lishe will try again by itself.' });
  };

  const loading = operations === null;
  const rows = (operations || []).map(toRow);
  const counts = rows.reduce((total, row) => ({ ...total, [row.state]: (total[row.state] || 0) + 1 }), {});
  const recent = (operations || [])
    .slice()
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, RECENT_LIMIT)
    .map(toRow);

  return (
    <>
      <PageHeader title="Sync" description="What is saved on this device and what has been sent." />

      <div className="ui-stack">
        <SyncStatusBar
          variant="expanded"
          state={sync.state}
          pausedReason={sync.pausedReason}
          pendingCount={sync.pendingCount}
          progress={sync.progress}
          lastSyncedAt={sync.lastSyncedAt}
          failure={sync.failure}
          conflictCount={sync.unresolvedConflicts}
          signedInOffline={sync.signedInOffline}
          canSync={sync.canSync}
          onSyncNow={syncNow}
        />

        <Card title="Records on this device" description="Every change saved here, by where it is now.">
          {loading ? null : (
            <ul className="sync-status__counts">
              {COUNT_ORDER.filter((state) => counts[state]).map((state) => (
                <li key={state} className="sync-status__count">
                  <RecordStatus state={state} />
                  <span className="sync-status__count-text">
                    <strong className="tabular-nums">{formatNumber(counts[state])}</strong> {COUNT_MEANING[state]}
                  </span>
                </li>
              ))}
              {rows.length === 0 && <li className="sync-status__count">Nothing saved on this device yet.</li>}
            </ul>
          )}
        </Card>

        <Card title="Recent changes" description={`The latest ${RECENT_LIMIT} changes saved on this device, newest first.`}>
          <DataTable
            caption="Recent changes"
            columns={COLUMNS}
            rows={recent}
            loading={loading}
            emptyState={{ title: 'No changes yet', description: 'Records you save on this device appear here.' }}
          />
        </Card>

        <Card title="How sending works">
          <ul className="sync-status__notes">
            <li>Everything you save is kept on this device first, so nothing is lost without a connection.</li>
            <li>Lishe sends your changes by itself when you are online. Sync now sends them straight away.</li>
            <li>If something does not send, it stays here and is tried again.</li>
            <li>{RECORD_STATES.waiting.label}: a record changed on another device too. You don’t need to do anything.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}

export default SyncStatus;
