import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { Alert, Badge, Button, Card, DataTable, FormField, PageHeader, useToast } from '../components/ui';
import { getEnrolmentChecks, getSchools, verifyEnrolment } from '../services/api';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useSession } from '../hooks/useSession';
import { formatDateTime, formatNumber } from '../utils/format';

const STATUS = {
  verified: { tone: 'success', label: 'Verified' },
  not_verified: { tone: 'warning', label: 'To check' },
  changed: { tone: 'warning', label: 'Changed since checked' },
  not_entered: { tone: 'neutral', label: 'Not entered' },
};

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
        girls: girls ? formatNumber(girls.learners) : '–',
        boys: boys ? formatNumber(boys.learners) : '–',
        changed: [girls, boys].some((c) => c && !c.verified),
      };
    })
    .filter(Boolean);
  return (
    <DataTable
      caption={`Enrolment at ${school.schoolName}`}
      getRowKey={(r) => r.key}
      rows={rows}
      columns={[
        { key: 'class', header: 'Class', primary: true, render: (r) => (school.status === 'changed' && r.changed ? <>{r.class} <Badge tone="warning">Changed</Badge></> : r.class) },
        { key: 'girls', header: 'Girls', align: 'end' },
        { key: 'boys', header: 'Boys', align: 'end' },
      ]}
    />
  );
}

/**
 * Enrolment checks, for programme officers: each school's termly enrolment, to check
 * against the admission register and verify, since it sets the food a school can request.
 * System administrators see the same list without the option to verify.
 */
function EnrolmentChecks() {
  const isOnline = useOnlineStatus();
  const toast = useToast();
  const { user, isAdmin } = useSession();
  const isOfficer = user?.role === 'programme_officer';
  const allowed = isAdmin || isOfficer;
  const [subCounties, setSubCounties] = useState([]);
  const [subCounty, setSubCounty] = useState('');
  const [termId, setTermId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (!isAdmin || !isOnline) return;
    getSchools()
      .then((res) => {
        const names = [...new Set((res.schools || []).map((s) => s.sub_county).filter(Boolean))].sort();
        setSubCounties(names);
        setSubCounty((current) => current || names[0] || '');
      })
      .catch((err) => setError(err.message));
  }, [isAdmin, isOnline]);

  const ready = allowed && isOnline && (!isAdmin || subCounty);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await getEnrolmentChecks({ ...(isAdmin && { subCounty }), ...(termId && { termId }) }));
    } catch (err) {
      setError(err.message);
    }
  }, [isAdmin, subCounty, termId]);

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
        <Alert tone="neutral" title="For programme officers">Enrolment checks are for programme officers and system administrators.</Alert>
      </>
    );
  }

  const schools = data?.schools || [];
  const toCheck = schools.filter((s) => s.status === 'not_verified' || s.status === 'changed').length;

  return (
    <>
      <PageHeader
        title="Enrolment checks"
        description="Each school's enrolment sets the food it can request. Check it against the admission register, then verify it."
      />
      <div className="ui-stack">
        <Card>
          <div className="weekly-review__controls">
            {isAdmin && (
              <FormField id="enrolment-sub-county" label="Sub-county" as="select" value={subCounty}
                onChange={(e) => setSubCounty(e.target.value)} options={subCounties.map((n) => ({ value: n, label: n }))} />
            )}
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
                    {isOfficer && (s.status === 'not_verified' || s.status === 'changed') && (
                      <Button size="sm" icon={CheckCircle2} loading={busy === s.schoolId} disabled={Boolean(busy)} onClick={() => verify(s)}>
                        Verify
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
          />
          {schools.filter((s) => s.schoolId === open).map((s) => <ClassTable key={s.schoolId} school={s} />)}
        </Card>
      </div>
    </>
  );
}

export default EnrolmentChecks;
