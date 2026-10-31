import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { liveQuery } from 'dexie';
import { CheckCircle2, CloudOff, CloudUpload, GitCompareArrows } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  PageHeader,
  StatCard,
  SyncStatusBar,
  useToast,
} from '../components/ui';
import db from '../db/database';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { useSession } from '../hooks/useSession';
import { formatDate, formatDateTime, formatNumber } from '../utils/format';

const RECENT_LIMIT = 20;

const STATUS = {
  pending: { tone: 'neutral', label: 'Waiting' },
  synced: { tone: 'success', label: 'Synced' },
  failed: { tone: 'warning', label: 'Did not sync' },
  conflict: { tone: 'danger', label: 'Conflict' },
  held: { tone: 'warning', label: 'Held for review' },
};

/**
 * One queued change in display form.
 */
// What each kind of queued change is called, and the date it is for
const RECORD_KINDS = {
  attendance: ['Attendance', 'attendanceDate'],
  mealDistribution: ['Meals', 'distributionDate'],
  dailyFeeding: ['Feeding', 'feedingDate'],
  enrolment: ['Enrolment', null],
  stockMovement: ['Stock entry', 'movementDate'],
  stockCount: ['Stock count', 'countDate'],
};

function toRow(op) {
  const [kind, dateField] = RECORD_KINDS[op.entityType] || ['Record', null];
  const date = dateField ? op.payload?.[dateField] : op.payload?.class;
  // A pending change that already failed once is shown as "did not sync" (it will be retried)
  const status = op.status === 'pending' && op.errorMessage ? 'failed' : op.status;
  return {
    id: op.id,
    record: `${kind}${date ? ` · ${dateField ? formatDate(date) : date}` : ''}`,
    change: op.operation === 'update' ? 'Edited' : 'New record',
    status,
    savedAt: formatDateTime(op.createdAt),
    attempts: op.retryCount || 0,
    capturedBy: op.capturedByName || '–',
    detail: status === 'failed' ? op.errorMessage : status === 'held' ? 'An administrator will review it' : '',
  };
}

const COLUMNS = [
  { key: 'record', header: 'Record', primary: true },
  { key: 'change', header: 'Change' },
  { key: 'capturedBy', header: 'Captured by' },
  {
    key: 'status',
    header: 'Status',
    render: (row) => <Badge tone={(STATUS[row.status] || STATUS.pending).tone}>{(STATUS[row.status] || STATUS.pending).label}</Badge>,
  },
  { key: 'savedAt', header: 'Saved on device' },
  { key: 'attempts', header: 'Attempts', align: 'end' },
];

/**
 * What is waiting on this device, what has reached the server, and a manual sync.
 * Reads the local sync queue only; syncing itself is unchanged.
 */
function SyncStatus() {
  const sync = useSyncStatus();
  const { isAdmin } = useSession();
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
      ? { tone: 'success', title: 'Sync finished', description: result.message }
      : { tone: 'warning', title: 'Sync did not finish', description: result.message || 'Lishe will try again automatically.' });
  };

  const loading = operations === null;
  const counts = (operations || []).reduce((total, op) => {
    const status = op.status === 'pending' && op.errorMessage ? 'failed' : op.status;
    total[status] = (total[status] || 0) + 1;
    return total;
  }, {});
  const recent = (operations || [])
    .slice()
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, RECENT_LIMIT)
    .map(toRow);
  const columns = recent.some((row) => row.detail)
    ? [...COLUMNS, { key: 'detail', header: 'Why' }]
    : COLUMNS;

  return (
    <>
      <PageHeader title="Sync status" description="What is waiting on this device and what has reached the server." />

      <div className="ui-stack">
        <SyncStatusBar
          variant="expanded"
          state={sync.state}
          pendingCount={sync.pendingCount}
          progress={sync.progress}
          lastSyncedAt={sync.lastSyncedAt}
          failure={sync.failure}
          conflictCount={sync.unresolvedConflicts}
          canSync={sync.canSync}
          onSyncNow={syncNow}
        />

        {sync.unresolvedConflicts > 0 && (
          <Alert
            tone="warning"
            title={sync.unresolvedConflicts === 1 ? '1 record needs a decision' : `${formatNumber(sync.unresolvedConflicts)} records need a decision`}
            action={isAdmin && <Button as={Link} to="/conflicts" variant="secondary" size="sm">Resolve</Button>}
          >
            The same record was changed on this device and on the server.
            {!isAdmin && ' An administrator will choose which version to keep.'}
          </Alert>
        )}

        <div className="ui-grid ui-grid--4">
          <StatCard label="Waiting" icon={CloudUpload} loading={loading} value={formatNumber(counts.pending || 0)} hint="Saved here, not sent yet" />
          <StatCard label="Synced" icon={CheckCircle2} loading={loading} value={formatNumber(counts.synced || 0)} hint="Reached the server" />
          <StatCard label="Did not sync" icon={CloudOff} loading={loading} value={formatNumber(counts.failed || 0)} hint="Retried automatically" />
          <StatCard label="Conflicts" icon={GitCompareArrows} loading={loading} value={formatNumber(sync.unresolvedConflicts)} hint="Need an administrator" />
        </div>

        <Card title="Recent changes" description={`The latest ${RECENT_LIMIT} changes saved on this device, newest first.`}>
          <DataTable
            caption="Recent changes"
            columns={columns}
            rows={recent}
            loading={loading}
            emptyState={{ title: 'No changes yet', description: 'Records you save on this device appear here until they sync.' }}
          />
        </Card>

        <Card title="How syncing works">
          <ul className="sync-status__notes">
            <li>Every record is saved on this device first, so nothing is lost without a connection.</li>
            <li>When the device is online and you are signed in, Lishe sends waiting changes automatically. Sync now sends them straight away.</li>
            <li>A change that does not sync stays on the device and is tried again.</li>
            <li>If the same record was changed somewhere else first, it becomes a conflict and an administrator chooses which version to keep.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}

export default SyncStatus;
