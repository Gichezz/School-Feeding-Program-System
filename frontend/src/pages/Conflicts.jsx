import { useEffect, useMemo, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { ArrowLeft, ArrowRight, CheckCircle2, GitCompareArrows } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  FormField,
  LoadingRegion,
  PageHeader,
  SkeletonText,
  SummaryList,
  useToast,
} from '../components/ui';
import db from '../db/database';
import { ATTENDANCE, MEALS } from '../features/recording/recordTypes';
import { toCount, validateAttendance, validateMeals } from '../features/recording/validation';
import { resolveConflict, deleteConflict } from '../sync/conflictService';
import { getSchools } from '../services/api';
import { getCachedSchools } from '../services/localDb';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useSession } from '../hooks/useSession';
import { formatDate, formatDateTime, formatNumber } from '../utils/format';

const CHOICES = [
  { value: 'keep_local', label: "Keep this device's version", description: 'The values saved on this device replace the server record.' },
  { value: 'keep_server', label: "Keep the server's version", description: "The server record stays as it is; this device's change is dropped." },
  { value: 'merge', label: 'Edit and merge', description: 'Enter the correct values yourself. They are checked like any other record.' },
];

function typeOf(conflict) {
  return conflict.entityType === 'attendance' ? ATTENDANCE : MEALS;
}

function dateOf(conflict) {
  const payload = conflict.localPayload || {};
  return formatDate(payload.attendanceDate || payload.distributionDate);
}

/**
 * Device and server values side by side for each count.
 */
function comparisonRows(conflict) {
  const type = typeOf(conflict);
  return type.fields.map((field) => {
    const device = conflict.localPayload?.[field.name];
    const server = conflict.serverRecord?.[field.serverName];
    return { ...field, device, server, differs: server !== undefined && Number(device) !== Number(server) };
  });
}

/**
 * Review and resolve records that were changed on this device and on the server.
 * Only administrators can resolve; resolving needs a connection.
 */
function Conflicts() {
  const isOnline = useOnlineStatus();
  const { isAdmin } = useSession();
  const toast = useToast();
  const [conflicts, setConflicts] = useState(null);
  const [schoolNames, setSchoolNames] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [choice, setChoice] = useState('');
  const [mergeValues, setMergeValues] = useState({});
  const [step, setStep] = useState('choose'); // 'choose' | 'confirm'
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const headingRef = useRef(null);

  // Live list of unresolved conflicts on this device
  useEffect(() => {
    const subscription = liveQuery(() => db.conflicts.where('status').equals('unresolved').toArray()).subscribe({
      next: (rows) => setConflicts(rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))),
      error: () => setConflicts([]),
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    getSchools()
      .then((res) => res.schools || [])
      .catch(() => getCachedSchools().catch(() => []))
      .then((schools) => setSchoolNames(Object.fromEntries(schools.map((s) => [s.id, s.name]))));
  }, []);

  const selected = conflicts?.find((conflict) => conflict.id === selectedId) || null;

  // Move focus to the heading of each new step for keyboard and screen reader users
  useEffect(() => {
    headingRef.current?.focus();
  }, [selectedId, step]);

  const open = (conflict) => {
    setSelectedId(conflict.id);
    setChoice('');
    setStep('choose');
    setError(null);
    // Start the merge form from the server's values
    const values = {};
    for (const field of typeOf(conflict).fields) {
      values[field.name] = String(conflict.serverRecord?.[field.serverName] ?? conflict.localPayload?.[field.name] ?? '');
    }
    setMergeValues(values);
  };

  const close = () => {
    setSelectedId(null);
    setStep('choose');
    setError(null);
  };

  const mergeCheck = useMemo(() => {
    if (!selected || choice !== 'merge') return null;
    const validate = selected.entityType === 'attendance' ? validateAttendance : validateMeals;
    return validate({ schoolId: 'set', date: dateOf(selected), ...mergeValues });
  }, [selected, choice, mergeValues]);
  const mergeErrors = mergeCheck?.errors || {};
  const canContinue = choice && (choice !== 'merge' || Object.keys(mergeErrors).length === 0);

  // The values each choice would leave on the server
  const resultValues = () => {
    const type = typeOf(selected);
    return type.fields.map((field) => {
      let value;
      if (choice === 'keep_local') value = selected.localPayload?.[field.name];
      else if (choice === 'keep_server') value = selected.serverRecord?.[field.serverName];
      else value = toCount(mergeValues[field.name]);
      return { key: field.name, label: field.label, value: formatNumber(value) };
    });
  };

  const confirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (choice === 'remove') {
        await deleteConflict(selected.id);
        toast.show({ tone: 'info', title: 'Removed from this device', description: 'The conflict is still recorded on the server.' });
      } else {
        const values = choice === 'merge'
          ? Object.fromEntries(Object.entries(mergeValues).map(([name, value]) => [name, toCount(value)]))
          : undefined;
        const result = await resolveConflict(selected.id, choice, values);
        toast.show({ tone: 'success', title: 'Conflict resolved', description: `The record is now at version ${result.version} on the server and on this device.` });
      }
      close();
    } catch (err) {
      setStep('choose');
      setError(/stale/i.test(err.message)
        ? 'The server record changed again since this conflict was recorded. Sync this device, then review the conflict again.'
        : err.message || 'The conflict could not be resolved. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const header = <PageHeader title="Conflicts" description="Records changed on this device and on the server. Choose which version to keep." />;

  if (!selected) {
    return (
      <>
        {header}
        <div className="ui-stack">
          {!isAdmin && (
            <Alert tone="info" title="Only an administrator can resolve conflicts">
              Conflicts stay recorded until an administrator reviews them. You can keep recording as normal.
            </Alert>
          )}
          <Card title="Waiting for a decision">
            {conflicts === null ? (
              <LoadingRegion label="Loading conflicts"><SkeletonText lines={3} /></LoadingRegion>
            ) : conflicts.length === 0 ? (
              <EmptyState compact icon={CheckCircle2} title="No conflicts" description="When the same record is changed on this device and on the server, it appears here." />
            ) : (
              <ul className="conflicts__list">
                {conflicts.map((conflict) => (
                  <li key={conflict.id} className="conflicts__item">
                    <GitCompareArrows className="conflicts__item-icon" aria-hidden="true" />
                    <div className="conflicts__item-text">
                      <p className="conflicts__item-title">{typeOf(conflict).title} · {dateOf(conflict)}</p>
                      <p className="conflicts__item-meta">
                        {schoolNames[conflict.localPayload?.schoolId] || 'School'} · found {formatDateTime(conflict.createdAt)}
                      </p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => open(conflict)}>Review</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </>
    );
  }

  const type = typeOf(selected);
  const rows = comparisonRows(selected);
  const chosen = CHOICES.find((c) => c.value === choice);

  return (
    <>
      {header}
      <div className="ui-stack">
        <div>
          <Button variant="ghost" icon={ArrowLeft} onClick={close} disabled={submitting}>All conflicts</Button>
        </div>

        {error && <Alert tone="danger" title="Not resolved">{error}</Alert>}
        {!isOnline && (
          <Alert tone="neutral" title="Resolving needs a connection">You can review the conflict now and resolve it when you are back online.</Alert>
        )}

        {step === 'choose' ? (
          <>
            <Card>
              <h2 ref={headingRef} tabIndex={-1} className="conflicts__heading">
                {type.title} · {dateOf(selected)}
              </h2>
              <p className="conflicts__meta">
                {schoolNames[selected.localPayload?.schoolId] || 'School'}. This device changed version {selected.baseVersion},
                but the server had already moved on to version {selected.serverVersion}.
              </p>
              <div className="conflicts__compare-scroll">
                <table className="conflicts__compare">
                  <caption className="visually-hidden">This device compared with the server</caption>
                  <thead>
                    <tr>
                      <th scope="col">Value</th>
                      <th scope="col" className="conflicts__num">This device</th>
                      <th scope="col" className="conflicts__num">Server</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.name} className={row.differs ? 'conflicts__row--differs' : undefined}>
                        <th scope="row">
                          {row.label}
                          {row.differs && <Badge tone="warning" className="conflicts__differs">Different</Badge>}
                        </th>
                        <td className="conflicts__num tabular-nums">{formatNumber(row.device)}</td>
                        <td className="conflicts__num tabular-nums">{row.server === undefined ? '–' : formatNumber(row.server)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {isAdmin ? (
              <Card title="Which version should the server keep?">
                <fieldset className="conflicts__choices">
                  <legend className="visually-hidden">Version to keep</legend>
                  {CHOICES.map((option) => (
                    <label key={option.value} className="conflicts__choice">
                      <input
                        type="radio"
                        name="resolution"
                        value={option.value}
                        checked={choice === option.value}
                        onChange={() => setChoice(option.value)}
                      />
                      <span className="conflicts__choice-text">
                        <span className="conflicts__choice-label">{option.label}</span>
                        <span className="conflicts__choice-description">{option.description}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>

                {choice === 'merge' && (
                  <div className="ui-grid ui-grid--2 conflicts__merge">
                    {type.fields.map((field) => (
                      <FormField
                        key={field.name}
                        label={field.label}
                        size="lg"
                        type="number"
                        inputMode="numeric"
                        min="0"
                        suffix={field.suffix}
                        value={mergeValues[field.name]}
                        onChange={(e) => setMergeValues((v) => ({ ...v, [field.name]: e.target.value }))}
                        error={mergeErrors[field.name]}
                        required
                      />
                    ))}
                  </div>
                )}

                <div className="conflicts__actions">
                  <Button icon={ArrowRight} iconPosition="end" onClick={() => setStep('confirm')} disabled={!canContinue || !isOnline}>
                    Continue
                  </Button>
                  <Button variant="ghost" onClick={() => { setChoice('remove'); setStep('confirm'); }}>
                    Remove from this device
                  </Button>
                </div>
              </Card>
            ) : (
              <Alert
                tone="info"
                title="Only an administrator can resolve conflicts"
                action={<Button variant="ghost" size="sm" onClick={() => { setChoice('remove'); setStep('confirm'); }}>Remove from this device</Button>}
              >
                This conflict stays recorded until an administrator reviews it.
              </Alert>
            )}
          </>
        ) : (
          <Card>
            <div className="conflicts__confirm">
              <h2 ref={headingRef} tabIndex={-1} className="conflicts__heading">
                {choice === 'remove' ? 'Remove this conflict from the device?' : 'Check before resolving'}
              </h2>
              {choice === 'remove' ? (
                <p>
                  The conflict is removed from this device only. The server record does not change, and the conflict
                  stays recorded on the server.
                </p>
              ) : (
                <>
                  <p>{chosen.label}. The server and this device will both hold these values for {type.title.toLowerCase()} on {dateOf(selected)}:</p>
                  <SummaryList rows={resultValues()} />
                  <p className="conflicts__note">This replaces the record for everyone and cannot be undone. The choice is recorded with your name.</p>
                </>
              )}
              <div className="conflicts__actions">
                <Button
                  variant={choice === 'remove' ? 'danger' : 'primary'}
                  onClick={confirm}
                  loading={submitting}
                  disabled={choice !== 'remove' && !isOnline}
                >
                  {choice === 'remove' ? 'Remove from this device' : 'Resolve conflict'}
                </Button>
                <Button variant="secondary" icon={ArrowLeft} onClick={() => { setStep('choose'); if (choice === 'remove') setChoice(''); }} disabled={submitting}>
                  Back
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

export default Conflicts;
