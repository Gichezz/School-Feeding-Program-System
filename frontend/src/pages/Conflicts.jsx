import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { ArrowLeft, CheckCircle2, GitCompareArrows } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, LoadingRegion, PageHeader, RecordStatus, SkeletonText, useToast } from '../components/ui';
import db from '../db/database';
import HeldRecordsCard from '../features/held/HeldRecordsCard';
import ServerConflicts from '../features/conflicts/ServerConflicts';
import { compareRows, conflictType, showValue } from '../features/conflicts/conflictTypes';
import { useResolvesConflicts } from '../features/conflicts/useServerConflictCount';
import { deleteConflict } from '../sync/conflictService';
import { getCachedSchools } from '../services/localDb';
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
    toast.show({ tone: 'info', title: 'Removed from this device', description: 'It will still be checked.' });
    setSelectedId(null);
    setConfirmRemove(false);
  };

  if (!selected) {
    return (
      <Card title="Waiting for your officer" description="Records changed on this device and on another one. Your programme officer chooses which to keep; you don’t need to do anything.">
        {conflicts === null ? (
          <LoadingRegion label="Loading conflicts"><SkeletonText lines={3} /></LoadingRegion>
        ) : conflicts.length === 0 ? (
          <EmptyState compact icon={CheckCircle2} title="Nothing waiting" description="A record changed on this device and on another one appears here until it has been checked." />
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
                    <RecordStatus state="waiting" />
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
            ? 'Another device had already recorded different numbers for this.'
            : 'This record was changed on another device before your change was sent.'}
        </p>
        <div className="conflicts__compare-scroll">
          <table className="conflicts__compare">
            <caption className="visually-hidden">Your numbers compared with the saved ones</caption>
            <thead>
              <tr><th scope="col">Value</th><th scope="col" className="conflicts__num">Yours</th><th scope="col" className="conflicts__num">Saved</th></tr>
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
          It is removed from this device only. It will still be checked.
        </Alert>
      ) : (
        <Alert
          tone="info"
          title="It will be checked"
          action={<Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)}>Remove from this device</Button>}
        >
          Keep recording as normal. Any changes to this record wait here until it has been checked.
        </Alert>
      )}
    </div>
  );
}

/**
 * Conflicts: programme officers resolve them from the server's list; a school
 * device shows those waiting on it.
 */
function Conflicts() {
  const resolves = useResolvesConflicts();

  return (
    <div data-density={resolves ? 'compact' : undefined}>
      <PageHeader
        title={resolves ? 'Conflicts' : 'Waiting for your officer'}
        description={resolves
          ? 'Records changed on two devices with different numbers. Decide which numbers to keep.'
          : 'Records changed on this device and on another one.'}
      />
      <div className="ui-stack">
        {resolves ? <ServerConflicts /> : <DeviceConflicts />}
        {resolves && <HeldRecordsCard />}
      </div>
    </div>
  );
}

export default Conflicts;
