import { useEffect, useMemo, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { ArrowLeft, ArrowRight, Pencil, Save } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  DateField,
  EmptyState,
  FormField,
  LoadingRegion,
  PageHeader,
  SkeletonText,
  SummaryList,
  useToast,
} from '../../components/ui';
import { getSchools } from '../../services/api';
import { cacheSchools, getCachedSchools } from '../../services/localDb';
import { mergeLocalAndServerRecords } from '../../utils/mergeRecords';
import { formatDate, formatNumber, todayDate, toDate } from '../../utils/format';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { manualSync } from '../../sync/syncManager';

const SYNC_DELAY_MS = 2000; // let the new operation reach the queue before syncing

function emptyValues(type, schoolId = '') {
  return {
    schoolId,
    date: todayDate(),
    lateReason: '',
    ...Object.fromEntries(type.fields.map((field) => [field.name, ''])),
  };
}

/**
 * One history row in display form, whether the record is on this device or only on the server.
 */
function toRow(type, record, schoolNames) {
  const isLocal = record.syncStatus !== undefined;
  const row = {
    raw: record,
    id: record.id,
    key: `${isLocal ? 'local' : 'server'}-${record.id}`,
    date: formatDate(isLocal ? record[type.dateField] : record[type.serverDateField]),
    schoolName: schoolNames[record.schoolId || record.school_id] || '',
    syncStatus: isLocal ? record.syncStatus : 'synced',
  };
  for (const field of type.fields) {
    row[field.name] = Number(isLocal ? record[field.name] : record[field.serverName]);
  }
  return row;
}

/**
 * Shared page for recording daily attendance or meals (identical layout for both).
 * Data handling is unchanged from the original pages: records are saved on the device
 * first and queued; when online, a sync starts shortly after saving.
 */
function RecordingPage({ type }) {
  const isOnline = useOnlineStatus();
  const toast = useToast();
  const [schools, setSchools] = useState([]);
  const [localRecords, setLocalRecords] = useState([]);
  const [serverRecords, setServerRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [values, setValues] = useState(() => emptyValues(type));
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [step, setStep] = useState('form');
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const formCardRef = useRef(null);
  const errorSummaryRef = useRef(null);
  const confirmHeadingRef = useRef(null);
  // Where to move keyboard focus after the next render: the error summary or the confirm heading
  const [focusTarget, setFocusTarget] = useState(null);

  useEffect(() => {
    if (focusTarget === 'errors') errorSummaryRef.current?.focus();
    if (focusTarget === 'confirm') confirmHeadingRef.current?.focus();
    if (focusTarget) setFocusTarget(null);
  }, [focusTarget]);

  // Records on this device, kept current as they are saved, edited and synced
  useEffect(() => {
    const subscription = liveQuery(() => type.store.loadLocal()).subscribe({
      next: (records) => { setLocalRecords(records); setLoadError(null); },
      error: () => setLoadError('Records saved on this device could not be read.'),
    });
    return () => subscription.unsubscribe();
  }, [type]);

  // Load schools (server first, then the offline cache) and history
  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      let schoolList = [];
      try {
        const response = await getSchools();
        schoolList = response.schools || [];
        await cacheSchools(schoolList);
      } catch {
        schoolList = await getCachedSchools().catch(() => []);
      }
      const serverList = await type.store.loadServer().catch(() => []);
      if (!active) return;
      setSchools(schoolList);
      setServerRecords(serverList);
      // Pre-select the school when the device records for only one
      if (schoolList.length === 1) setValues((v) => (v.schoolId ? v : { ...v, schoolId: schoolList[0].id }));
      setLoading(false);
    }
    load();
    return () => { active = false; };
  }, [type]);

  const schoolNames = useMemo(() => Object.fromEntries(schools.map((s) => [s.id, s.name])), [schools]);
  const history = useMemo(() => {
    const merged = mergeLocalAndServerRecords(localRecords, serverRecords, {
      localDateField: type.dateField,
      serverDateField: type.serverDateField,
    });
    return merged
      .map((record) => toRow(type, record, schoolNames))
      .sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0));
  }, [localRecords, serverRecords, schoolNames, type]);

  const { errors, check, entry } = type.validate(values);
  const errorFor = (name) => {
    // The totals rule shows as soon as every number is entered; other errors after leaving a field
    if (name === type.checkField && check && !check.ok) return errors[name];
    return submitted || touched[name] ? errors[name] : undefined;
  };
  const visibleErrors = submitted ? Object.entries(errors) : [];
  const live = type.liveSummary(check, values);
  const schoolName = schoolNames[values.schoolId] || '';

  const setField = (name, value) => setValues((v) => ({ ...v, [name]: value }));
  const touch = (name) => setTouched((t) => ({ ...t, [name]: true }));

  const resetForm = () => {
    setValues(emptyValues(type, schools.length === 1 ? schools[0].id : values.schoolId));
    setTouched({});
    setSubmitted(false);
    setEditing(null);
    setStep('form');
  };

  const handleContinue = (event) => {
    event.preventDefault();
    setSubmitted(true);
    setSaveError(null);
    if (Object.keys(errors).length > 0) {
      setFocusTarget('errors');
      return;
    }
    setStep('confirm');
    setFocusTarget('confirm');
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    const data = {
      schoolId: values.schoolId,
      [type.dateField]: values.date,
      ...Object.fromEntries(type.fields.map((field) => [field.name, parseInt(values[field.name], 10)])),
      ...(entry.late ? { lateReason: values.lateReason.trim() } : {}),
    };
    try {
      if (editing) {
        // Find the record on this device by its local id, or by the server id it was created from
        let localRecord = await type.store.getLocalById(editing.id);
        if (!localRecord && editing.serverId) {
          const all = await type.store.loadLocal();
          localRecord = all.find((r) => r.serverId === editing.serverId);
        }
        if (!localRecord) {
          // Server-only record: create it on this device, remembering the server id
          await type.store.saveLocal({ ...data, serverId: editing.id });
        } else {
          await type.store.updateLocal(localRecord.id, data);
        }
      } else {
        await type.store.saveLocal(data);
      }
      if (isOnline) {
        setTimeout(() => { manualSync().catch(() => {}); }, SYNC_DELAY_MS);
      }
      toast.show({
        title: type.savedToast,
        description: isOnline ? 'Lishe is syncing it now.' : 'It will sync when you are back online.',
      });
      resetForm();
    } catch (err) {
      setSaveError(err.message || 'The record could not be saved on this device.');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (row) => {
    setEditing(row.raw);
    setValues({
      schoolId: row.raw.schoolId || row.raw.school_id || values.schoolId,
      date: row.date,
      lateReason: '',
      ...Object.fromEntries(type.fields.map((field) => [field.name, String(row[field.name])])),
    });
    setTouched(Object.fromEntries(type.fields.map((field) => [field.name, true])));
    setSubmitted(false);
    setSaveError(null);
    setStep('form');
    formCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const fieldId = (name) => `${type.key}-${name}`;
  const summaryRows = [
    ...(schoolName ? [{ key: 'school', label: 'School', value: schoolName }] : []),
    { key: 'date', label: 'Date', value: values.date },
    ...(entry.late ? [{ key: 'lateReason', label: 'Reason for late entry', value: values.lateReason.trim() }] : []),
    ...type.fields.map((field) => ({
      key: field.name,
      label: field.label,
      value: `${formatNumber(values[field.name])} ${field.suffix}`,
    })),
  ];

  const columns = [
    {
      key: 'date',
      header: 'Date',
      primary: true,
      render: (row) => (
        <span className="recording__date">
          {row.date}
          {row.syncStatus === 'conflict' && <Badge tone="danger">Conflict</Badge>}
        </span>
      ),
    },
    ...type.historyColumns.map((column) => ({ render: (row) => formatNumber(row[column.key]), ...column })),
    {
      key: 'actions',
      header: <span className="visually-hidden">Actions</span>,
      align: 'end',
      render: (row) => (
        <Button variant="ghost" size="sm" icon={Pencil} onClick={() => startEdit(row)} aria-label={`Edit ${type.noun} for ${row.date}`}>
          Edit
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={type.title} description={type.description} />

      <div className="ui-stack">
        <div ref={formCardRef} className="recording__form-anchor">
          {step === 'form' ? (
            <Card title={editing ? type.editTitle : type.formTitle} description={schoolName && !editing ? schoolName : undefined}>
              <form className="recording__form" onSubmit={handleContinue} noValidate>
                {editing && (
                  <Alert
                    tone="info"
                    title={`Editing the ${type.noun} for ${formatDate(values.date)}`}
                    action={<Button variant="ghost" size="sm" onClick={resetForm}>Cancel</Button>}
                  />
                )}
                {visibleErrors.length > 0 && (
                  <div ref={errorSummaryRef} tabIndex={-1} className="recording__error-summary">
                    <Alert tone="danger" title="Check the highlighted answers">
                      <ul className="recording__error-list">
                        {visibleErrors.map(([name, message]) => (
                          <li key={name}><a href={`#${fieldId(name)}`}>{message}</a></li>
                        ))}
                      </ul>
                    </Alert>
                  </div>
                )}
                {!loading && schools.length === 0 && (
                  <Alert tone="warning" title="No school on this device yet">
                    Lishe needs to connect once to load your school. Connect to the internet and reopen this page.
                  </Alert>
                )}

                <div className="ui-grid ui-grid--2">
                  {schools.length > 1 && (
                    <FormField
                      id={fieldId('schoolId')}
                      label="School"
                      as="select"
                      required
                      value={values.schoolId}
                      onChange={(e) => setField('schoolId', e.target.value)}
                      onBlur={() => touch('schoolId')}
                      error={errorFor('schoolId')}
                      options={[{ value: '', label: 'Select the school' }, ...schools.map((s) => ({ value: s.id, label: s.name }))]}
                    />
                  )}
                  <DateField
                    id={fieldId('date')}
                    label="Date"
                    required
                    hint="DD-MM-YYYY. Today, or up to 3 school days back; older dates need a reason"
                    value={values.date}
                    onChange={(date) => setField('date', date)}
                    onBlur={() => touch('date')}
                    error={errorFor('date')}
                  />
                </div>

                {entry.late && (
                  <FormField
                    id={fieldId('lateReason')}
                    label="Reason for entering this date late"
                    hint={`This date is ${entry.schoolDays} school days ago. An administrator will check the record against the school's register.`}
                    as="textarea"
                    rows={2}
                    maxLength={300}
                    required
                    value={values.lateReason}
                    onChange={(e) => setField('lateReason', e.target.value)}
                    onBlur={() => touch('lateReason')}
                    error={errorFor('lateReason')}
                  />
                )}

                <div className={`ui-grid ui-grid--${type.fields.length === 3 ? 3 : 2}`}>
                  {type.fields.map((field) => (
                    <FormField
                      key={field.name}
                      id={fieldId(field.name)}
                      label={field.label}
                      hint={field.hint}
                      size="lg"
                      type="number"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      min="0"
                      step="1"
                      required
                      suffix={field.suffix}
                      value={values[field.name]}
                      onChange={(e) => setField(field.name, e.target.value)}
                      onBlur={() => touch(field.name)}
                      error={errorFor(field.name)}
                    />
                  ))}
                </div>

                {live && <Alert tone={live.tone}>{live.text}</Alert>}

                <div className="recording__actions">
                  <Button type="submit" size="lg" icon={ArrowRight} iconPosition="end" disabled={loading}>
                    Continue
                  </Button>
                  {editing && <Button variant="secondary" size="lg" onClick={resetForm}>Cancel</Button>}
                </div>
              </form>
            </Card>
          ) : (
            <Card>
              <div className="recording__confirm">
                <h2 ref={confirmHeadingRef} tabIndex={-1} className="recording__confirm-title">Check before saving</h2>
                <SummaryList rows={summaryRows} />
                {live && <Alert tone={live.tone}>{live.text}</Alert>}
                {saveError && <Alert tone="danger" title="Not saved">{saveError}</Alert>}
                <p className="recording__note">
                  {isOnline
                    ? 'Lishe saves this on the device and syncs it straight away.'
                    : 'You are offline. Lishe saves this on the device and syncs it when you are back online.'}
                </p>
                <div className="recording__actions">
                  <Button size="lg" icon={Save} loading={saving} onClick={handleSave}>
                    Save on this device
                  </Button>
                  <Button variant="secondary" size="lg" icon={ArrowLeft} onClick={() => setStep('form')} disabled={saving}>
                    Change
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>

        <Card title="History" description="Newest first. Records marked “Not yet synced” are only on this device so far.">
          {loadError && <Alert tone="danger" title="Could not load history">{loadError}</Alert>}
          {loading ? (
            <LoadingRegion label="Loading history"><SkeletonText lines={4} /></LoadingRegion>
          ) : history.length === 0 ? (
            <EmptyState icon={type.icon} {...type.emptyHistory} />
          ) : (
            <DataTable
              caption={`${type.title} history`}
              columns={columns}
              rows={history}
              getRowKey={(row) => row.key}
              isUnsynced={(row) => row.syncStatus === 'pending'}
            />
          )}
        </Card>
      </div>
    </>
  );
}

export default RecordingPage;
