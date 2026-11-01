import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { ArrowLeft, CheckCircle2, GitCompareArrows } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, LoadingRegion, PageHeader, SkeletonText, useToast } from '../components/ui';
import db from '../db/database';
import HeldRecordsCard from '../features/held/HeldRecordsCard';
import ServerConflicts from '../features/conflicts/ServerConflicts';
import { compareRows, conflictType, showValue } from '../features/conflicts/conflictTypes';
import { useResolvesConflicts } from '../features/conflicts/useServerConflictCount';
import { deleteConflict } from '../sync/conflictService';
import { getCachedSchools } from '../services/localDb';
import { useSession } from '../hooks/useSession';
import { formatDateTime } from '../utils/format';

/**
 * Conflicts waiting on this school device. School staff cannot resolve them: their
 * programme officer does, from the server's list, and the decision arrives with the
 * device's next download. Edits to a record in conflict wait on the device until then.
 */
function DeviceConflicts() {
  const toast = useToast();
  const [conflicts, setConflicts] = useState(null);
  const [schoolNames, setSchoolNames] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const headingRef = useRef(null);

  useEffect(() => {
    const subscription = liveQuery(() => db.conflicts.where('status').equals('unresolved').toArray()).subscribe({
      next: (rows) => setConflicts(rows.filter((c) => conflictType(c.entityType))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))),
      error: () => setConflicts([]),
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    getCachedSchools().catch(() => []).then((schools) => setSchoolNames(Object.fromEntries(schools.map((s) => [s.id, s.name]))));
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, [selectedId, confirmRemove]);

  const selected = conflicts?.find((c) => c.id === selectedId) || null;

  const remove = async () => {
    await deleteConflict(selected.id);
    toast.show({ tone: 'info', title: 'Removed from this device', description: 'The conflict is still recorded on the server for your programme officer.' });
    setSelectedId(null);
    setConfirmRemove(false);
  };

  if (!selected) {
    return (
      <Card title="Waiting for your programme officer">
        {conflicts === null ? (
          <LoadingRegion label="Loading conflicts"><SkeletonText lines={3} /></LoadingRegion>
        ) : conflicts.length === 0 ? (
          <EmptyState compact icon={CheckCircle2} title="No conflicts" description="When a record saved here was also changed on another device, it appears here until it is resolved." />
        ) : (
          <ul className="conflicts__list">
            {conflicts.map((conflict) => {
              const type = conflictType(conflict.entityType);
              return (
                <li key={conflict.id} className="conflicts__item">
                  <GitCompareArrows className="conflicts__item-icon" aria-hidden="true" />
                  <div className="conflicts__item-text">
                    <p className="conflicts__item-title">{type.title} · {type.when(conflict.localPayload, conflict)}</p>
                    <p className="conflicts__item-meta">
                      {schoolNames[conflict.localPayload?.schoolId] || 'School'} · found {formatDateTime(conflict.createdAt)}
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setSelectedId(conflict.id)}>View</Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    );
  }

  const type = conflictType(selected.entityType);
  const rows = compareRows(type, selected.localPayload, selected.serverRecord);
  return (
    <div className="ui-stack">
      <div><Button variant="ghost" icon={ArrowLeft} onClick={() => { setSelectedId(null); setConfirmRemove(false); }}>All conflicts</Button></div>
      <Card>
        <h2 ref={headingRef} tabIndex={-1} className="conflicts__heading">{type.title} · {type.when(selected.localPayload, selected)}</h2>
        <p className="conflicts__meta">
          {selected.baseVersion === 0
            ? 'This device recorded this as new, but another device had already synced different numbers for it.'
            : `This device changed version ${selected.baseVersion}, but the server had already moved on to version ${selected.serverVersion}.`}
        </p>
        <div className="conflicts__compare-scroll">
          <table className="conflicts__compare">
            <caption className="visually-hidden">This device compared with the server</caption>
            <thead>
              <tr><th scope="col">Value</th><th scope="col" className="conflicts__num">This device</th><th scope="col" className="conflicts__num">Server</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name} className={row.differs ? 'conflicts__row--differs' : undefined}>
                  <th scope="row">{row.label}{row.differs && <Badge tone="warning" className="conflicts__differs">Different</Badge>}</th>
                  <td className="conflicts__num tabular-nums">{showValue(row, row.device)}</td>
                  <td className="conflicts__num tabular-nums">{row.server === undefined ? '–' : showValue(row, row.server)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {confirmRemove ? (
        <Alert
          tone="warning"
          title="Remove this conflict from the device?"
          action={<Button variant="danger" size="sm" onClick={remove}>Remove from this device</Button>}
        >
          Only this device's copy is removed. The server record does not change, and your programme officer still sees the conflict.
        </Alert>
      ) : (
        <Alert
          tone="info"
          title="Your programme officer decides"
          action={<Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)}>Remove from this device</Button>}
        >
          Keep recording as normal. Changes to this record wait on the device until the conflict is resolved, then sync.
        </Alert>
      )}
    </div>
  );
}

/**
 * Conflicts: officers and administrators resolve them from the server's list; a school
 * device shows those waiting on it.
 */
function Conflicts() {
  const { isAdmin } = useSession();
  const resolves = useResolvesConflicts();

  return (
    <>
      <PageHeader
        title="Conflicts"
        description={resolves
          ? "Records a school's device changed after they had already changed on the server. Decide which version to keep."
          : 'Records saved on this device that were also changed on another device.'}
      />
      <div className="ui-stack">
        {resolves ? <ServerConflicts /> : <DeviceConflicts />}
        {isAdmin && <HeldRecordsCard />}
      </div>
    </>
  );
}

export default Conflicts;
