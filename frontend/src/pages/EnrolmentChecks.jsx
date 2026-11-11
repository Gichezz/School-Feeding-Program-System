import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { Alert, Badge, Button, Card, DataTable, FormField, PageHeader, useToast } from '../components/ui';
import { getEnrolmentChecks, recordEnrolmentDiscrepancy, verifyEnrolment } from '../services/api';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useSession } from '../hooks/useSession';
import { formatDateTime, formatNumber } from '../utils/format';

const STATUS = {
  verified: { tone: 'success', label: 'Verified' },
  not_verified: { tone: 'warning', label: 'To check' },
  changed: { tone: 'warning', label: 'Changed since checked' },
  discrepancy: { tone: 'danger', label: 'Discrepancy' },
  not_entered: { tone: 'neutral', label: 'Not entered' },
};

const REASONS = { admission: 'new admission', transfer: 'transfer', correction: 'correction' };
const TO_CHECK = ['not_verified', 'changed', 'discrepancy'];

/** A class's number, with the last verified one when it has changed since. */
function count(c) {
  if (!c) return '–';
  if (c.verified || c.verifiedLearners === null || c.verifiedLearners === c.learners) return formatNumber(c.learners);
  return `${formatNumber(c.learners)} (was ${formatNumber(c.verifiedLearners)})`;
}

const CLASS_ORDER = ['PP1', 'PP2', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9'];

/** One school's enrolment by class: girls and boys side by side. */
function ClassTable({ school }) {
  const rows = CLASS_ORDER
    .map((name) => {
      const of = (sex) => school.classes.find((c) => c.class === name && c.sex === sex);
      const girls = of('F');
      const boys = of('M');
      if (!girls && !boys) return null;
      return {
        key: name,
        class: name,
        girls: count(girls),
        boys: count(boys),
        changed: [girls, boys].some((c) => c && !c.verified),
        reasons: [...new Set([girls, boys].filter((c) => c && !c.verified && c.changeReason).map((c) => REASONS[c.changeReason]))],
      };
    })
    .filter(Boolean);
  return (
    <DataTable
      caption={`Enrolment at ${school.schoolName}`}
      getRowKey={(r) => r.key}
      rows={rows}
      columns={[
        {
          key: 'class',
          header: 'Class',
          primary: true,
          render: (r) => (school.status === 'changed' && r.changed
            ? <>{r.class} <Badge tone="warning">{r.reasons.length ? `Changed: ${r.reasons.join(', ')}` : 'Changed'}</Badge></>
            : r.class),
        },
        { key: 'girls', header: 'Girls', align: 'end' },
        { key: 'boys', header: 'Boys', align: 'end' },
      ]}
    />
  );
}

/**
 * What the officer found does not match the register: a note the school sees on its
 * Enrolment page. The school's next change sends it back to be checked.
 */
function DiscrepancyForm({ school, termId, onRecorded }) {
  const toast = useToast();
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const save = async (event) => {
    event.preventDefault();
    if (!note.trim()) return setError('Say what does not match the register');
    setSaving(true);
    setError(null);
    try {
      await recordEnrolmentDiscrepancy(school.schoolId, termId, note.trim());
      toast.show({ title: 'Discrepancy recorded', description: `${school.schoolName} will see your note.` });
      setWriting(false);
      setNote('');
      await onRecorded();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
    return undefined;
  };

  if (!writing) {
    return (
      <Button variant="secondary" size="sm" icon={AlertTriangle} onClick={() => setWriting(true)}>
        Does not match the register
      </Button>
    );
  }
  return (
    <form className="ui-stack" onSubmit={save} noValidate>
      <FormField id={`discrepancy-${school.schoolId}`} label="What does not match" as="textarea" rows={3} maxLength={500}
        hint="For example: Grade 4 girls are 47 in the admission register." value={note}
        onChange={(e) => setNote(e.target.value)} error={error || undefined} />
      <div className="users__actions">
        <Button type="submit" size="sm" loading={saving}>Record discrepancy</Button>
        <Button variant="secondary" size="sm" onClick={() => setWriting(false)} disabled={saving}>Cancel</Button>
      </div>
    </form>
  );
}

/** A school's classes, any discrepancy already recorded, and the option to record one. */
function SchoolDetail({ school, termId, onRecorded }) {
  return (
    <div className="ui-stack">
      {school.discrepancy && (
        <Alert tone="danger" title="Discrepancy recorded">
          {school.discrepancy.note} ({formatDateTime(school.discrepancy.at)}{school.discrepancy.by ? `, ${school.discrepancy.by}` : ''})
        </Alert>
      )}
      <ClassTable school={school} />
      {school.status !== 'discrepancy' && <DiscrepancyForm school={school} termId={termId} onRecorded={onRecorded} />}
    </div>
  );
}

/**
 * Enrolment checks, for programme officers: each school's termly enrolment, to check
 * against the admission register and verify, since it sets the food a school can request.
 * When it does not match, the officer records a discrepancy with a note for the school.
 */
function EnrolmentChecks() {
  const isOnline = useOnlineStatus();
  const toast = useToast();
  const { user } = useSession();
  const isOfficer = user?.role === 'programme_officer';
  const allowed = isOfficer;
  const [termId, setTermId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(null);

  const ready = allowed && isOnline;

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await getEnrolmentChecks({ ...(termId && { termId }) }));
    } catch (err) {
      setError(err.message);
    }
  }, [termId]);

  useEffect(() => {
    setData(null);
    if (ready) load();
  }, [ready, load]);

  const verify = async (school) => {
    setBusy(school.schoolId);
    try {
      await verifyEnrolment(school.schoolId, data.term.id);
      toast.show({ tone: 'success', title: 'Enrolment verified', description: `${school.schoolName}, ${data.term.label}.` });
      await load();
    } catch (err) {
      toast.show({ tone: 'danger', title: 'Not verified', description: err.message });
    } finally {
      setBusy(null);
    }
  };

  if (!allowed) {
    return (
      <>
        <PageHeader title="Enrolment checks" />
        <Alert tone="neutral" title="For programme officers">Enrolment checks are for programme officers.</Alert>
      </>
    );
  }

  const schools = data?.schools || [];
  const toCheck = schools.filter((s) => TO_CHECK.includes(s.status)).length;

  return (
    <>
      <PageHeader
        title="Enrolment checks"
        description="Each school's enrolment sets the food it can request. Check it against the admission register, then verify it."
      />
      <div className="ui-stack">
        <Card>
          <div className="weekly-review__controls">
            <FormField id="enrolment-term" label="Term" as="select" value={termId || data?.term.id || ''}
              onChange={(e) => setTermId(e.target.value)}
              options={(data?.terms || []).map((t) => ({ value: t.id, label: t.label }))} />
          </div>
        </Card>

        {!isOnline && <Alert tone="neutral" title="You are offline">Enrolment checks need a connection.</Alert>}
        {error && <Alert tone="danger" title="Could not load enrolment">{error}</Alert>}

        <Card
          title="Schools"
          description={data ? (toCheck === 0 ? 'Nothing waiting to be checked.' : `${toCheck} of ${schools.length} schools to check`) : undefined}
        >
          <DataTable
            caption="Enrolment by school"
            getRowKey={(s) => s.schoolId}
            rows={schools}
            loading={ready && !data && !error}
            emptyState={{ title: 'No schools', description: 'No schools are registered in this sub-county.' }}
            columns={[
              { key: 'schoolName', header: 'School', primary: true },
              { key: 'learners', header: 'Learners', align: 'end', render: (s) => (s.status === 'not_entered' ? '–' : formatNumber(s.learners)) },
              { key: 'status', header: 'Status', render: (s) => <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge> },
              {
                key: 'checked',
                header: 'Last checked',
                render: (s) => (s.verifiedAt ? `${formatDateTime(s.verifiedAt)}${s.verifiedBy ? ` by ${s.verifiedBy}` : ''}` : '–'),
              },
              {
                key: 'actions',
                header: <span className="visually-hidden">Actions</span>,
                render: (s) => (
                  <div className="users__actions users__actions--tight">
                    {s.status !== 'not_entered' && (
                      <Button variant="ghost" size="sm" icon={open === s.schoolId ? ChevronUp : ChevronDown}
                        onClick={() => setOpen(open === s.schoolId ? null : s.schoolId)}>
                        {open === s.schoolId ? 'Hide' : 'Classes'}
                      </Button>
                    )}
                    {isOfficer && TO_CHECK.includes(s.status) && (
                      <Button size="sm" icon={CheckCircle2} loading={busy === s.schoolId} disabled={Boolean(busy)} onClick={() => verify(s)}>
                        Verify
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
          />
          {schools.filter((s) => s.schoolId === open).map((s) => (
            <SchoolDetail key={s.schoolId} school={s} termId={data.term.id} onRecorded={load} />
          ))}
        </Card>
      </div>
    </>
  );
}

export default EnrolmentChecks;
