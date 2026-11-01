import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, GitCompareArrows } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, FormField, LoadingRegion, SkeletonText, SummaryList, useToast } from '../../components/ui';
import { getConflicts, resolveConflict } from '../../services/api';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { formatDateTime } from '../../utils/format';
import { compareRows, conflictType, isEditable, mergeStart, mergeValues, showValue } from './conflictTypes';
import { CONFLICTS_CHANGED_EVENT } from './useServerConflictCount';

const CHOICES = [
  { value: 'keep_local', label: "Keep the device's version", description: "The values the school's device sent replace the server record." },
  { value: 'keep_server', label: "Keep the server's version", description: "The server record stays as it is; the device's change is dropped." },
  { value: 'merge', label: 'Enter the correct numbers', description: 'For example after calling the school to check the register. Checked like any other record.' },
];

/** The server's conflict row in the shape the page uses. */
function fromServer(row) {
  return {
    id: row.conflict_id,
    entityType: row.entity_type,
    schoolName: row.school_name,
    termLabel: row.term_label,
    baseVersion: row.base_version,
    serverVersion: row.server_version,
    local: row.local_payload,
    server: row.server_payload,
    createdAt: row.created_at,
  };
}

/**
 * Conflicts for programme officers (their sub-county) and administrators, from the
 * server: a school's device changed a record that had already changed on the server,
 * or two devices recorded the same day. Resolving here needs no access to the school's
 * device; the decision reaches its devices with their next download.
 */
function ServerConflicts() {
  const isOnline = useOnlineStatus();
  const toast = useToast();
  const [conflicts, setConflicts] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [choice, setChoice] = useState('');
  const [form, setForm] = useState({});
  const [step, setStep] = useState('choose');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const headingRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const res = await getConflicts({ status: 'unresolved' });
      setConflicts((res.conflicts || []).map(fromServer).filter((c) => conflictType(c.entityType)));
    } catch (err) {
      setConflicts([]);
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => {
    setConflicts(null);
    if (isOnline) load();
  }, [isOnline, load]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [selectedId, step]);

  const selected = conflicts?.find((c) => c.id === selectedId) || null;
  const type = selected ? conflictType(selected.entityType) : null;

  const open = (conflict) => {
    setSelectedId(conflict.id);
    setChoice('');
    setStep('choose');
    setError(null);
    setForm(mergeStart(conflictType(conflict.entityType), conflict.local, conflict.server));
  };
  const close = () => { setSelectedId(null); setChoice(''); setStep('choose'); setError(null); };

  const merge = useMemo(() => (selected && choice === 'merge' ? mergeValues(type, selected.local, form) : null), [selected, type, choice, form]);
  const canContinue = Boolean(choice) && (choice !== 'merge' || (merge && Object.keys(merge.errors).length === 0));

  const resultRows = () => type.fields.map((field) => {
    let value;
    if (choice === 'keep_local') value = selected.local?.[field.name];
    else if (choice === 'keep_server') value = selected.server?.[field.serverName];
    else value = merge.values[field.name];
    return { key: field.name, label: field.label, value: showValue(field, value) };
  });

  const confirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await resolveConflict(selected.id, { resolution: choice, ...(choice === 'merge' ? { values: merge.values } : {}) });
      toast.show({ tone: 'success', title: 'Conflict resolved', description: `${type.title} at ${selected.schoolName} is now version ${result.version}. The school's devices get it with their next sync.` });
      window.dispatchEvent(new Event(CONFLICTS_CHANGED_EVENT));
      close();
      load();
    } catch (err) {
      setStep('choose');
      setError(err.status === 409
        ? 'The record changed again on the server since this conflict was recorded. The list has been refreshed; review it again.'
        : err.message || 'The conflict could not be resolved. Try again.');
      if (err.status === 409) load();
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOnline) {
    return <Alert tone="neutral" title="You are offline">Conflicts are kept on the server; reviewing them needs a connection.</Alert>;
  }

  if (!selected) {
    return (
      <Card title="Waiting for a decision">
        {loadError && <Alert tone="danger" title="Could not load conflicts">{loadError}</Alert>}
        {conflicts === null ? (
          <LoadingRegion label="Loading conflicts"><SkeletonText lines={3} /></LoadingRegion>
        ) : conflicts.length === 0 ? (
          <EmptyState
            compact
            icon={CheckCircle2}
            title="No conflicts"
            description="A conflict appears here when a school's device changes a record that had already changed on the server, or two devices record the same day differently. Stock entries never conflict."
          />
        ) : (
          <ul className="conflicts__list">
            {conflicts.map((conflict) => {
              const t = conflictType(conflict.entityType);
              return (
                <li key={conflict.id} className="conflicts__item">
                  <GitCompareArrows className="conflicts__item-icon" aria-hidden="true" />
                  <div className="conflicts__item-text">
                    <p className="conflicts__item-title">{t.title} · {t.when(conflict.local, conflict)}</p>
                    <p className="conflicts__item-meta">{conflict.schoolName || 'School'} · found {formatDateTime(conflict.createdAt)}</p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => open(conflict)}>Review</Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    );
  }

  const rows = compareRows(type, selected.local, selected.server);
  const chosen = CHOICES.find((c) => c.value === choice);
  const choices = CHOICES.filter((c) => c.value !== 'merge' || type.canMerge(selected.local, selected.server));

  return (
    <div className="ui-stack">
      <div><Button variant="ghost" icon={ArrowLeft} onClick={close} disabled={submitting}>All conflicts</Button></div>
      {error && <Alert tone="danger" title="Not resolved">{error}</Alert>}

      {step === 'choose' ? (
        <>
          <Card>
            <h2 ref={headingRef} tabIndex={-1} className="conflicts__heading">{type.title} · {type.when(selected.local, selected)}</h2>
            <p className="conflicts__meta">
              {selected.schoolName || 'School'}.{' '}
              {selected.baseVersion === 0
                ? 'A device recorded this as a new record, but another device had already synced different numbers for it.'
                : `A device changed version ${selected.baseVersion}, but the server had already moved on to version ${selected.serverVersion}.`}
            </p>
            <div className="conflicts__compare-scroll">
              <table className="conflicts__compare">
                <caption className="visually-hidden">The device's version compared with the server's</caption>
                <thead>
                  <tr>
                    <th scope="col">Value</th>
                    <th scope="col" className="conflicts__num">Device</th>
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
                      <td className="conflicts__num tabular-nums">{showValue(row, row.device)}</td>
                      <td className="conflicts__num tabular-nums">{showValue(row, row.server)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Which version should the server keep?">
            <fieldset className="conflicts__choices">
              <legend className="visually-hidden">Version to keep</legend>
              {choices.map((option) => (
                <label key={option.value} className="conflicts__choice">
                  <input type="radio" name="resolution" value={option.value} checked={choice === option.value} onChange={() => setChoice(option.value)} />
                  <span className="conflicts__choice-text">
                    <span className="conflicts__choice-label">{option.label}</span>
                    <span className="conflicts__choice-description">{option.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {choices.length < CHOICES.length && (
              <p className="conflicts__note">The two versions disagree on whether learners were fed, so keep one of them; the numbers can be corrected afterwards.</p>
            )}

            {choice === 'merge' && (
              <div className="ui-grid ui-grid--2 conflicts__merge">
                {type.fields.filter(isEditable).map((field) => (
                  <FormField
                    key={field.name}
                    label={field.label}
                    size="lg"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step={field.kind === 'kg' ? '0.5' : '1'}
                    suffix={field.kind === 'kg' ? 'kg' : undefined}
                    hint={field.optional ? 'Optional' : undefined}
                    value={form[field.name] ?? ''}
                    onChange={(e) => setForm((v) => ({ ...v, [field.name]: e.target.value }))}
                    error={merge?.errors[field.name]}
                    required={!field.optional}
                  />
                ))}
              </div>
            )}

            <div className="conflicts__actions">
              <Button icon={ArrowRight} iconPosition="end" onClick={() => setStep('confirm')} disabled={!canContinue}>Continue</Button>
            </div>
          </Card>
        </>
      ) : (
        <Card>
          <div className="conflicts__confirm">
            <h2 ref={headingRef} tabIndex={-1} className="conflicts__heading">Check before resolving</h2>
            <p>{chosen.label}. The server and the school's devices will hold these values for {type.title.toLowerCase()}, {type.when(selected.local, selected)}:</p>
            <SummaryList rows={resultRows()} />
            <p className="conflicts__note">This becomes a new version in the record's history, recorded with your name. Earlier versions are kept.</p>
            <div className="conflicts__actions">
              <Button onClick={confirm} loading={submitting}>Resolve conflict</Button>
              <Button variant="secondary" icon={ArrowLeft} onClick={() => setStep('choose')} disabled={submitting}>Back</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

export default ServerConflicts;
