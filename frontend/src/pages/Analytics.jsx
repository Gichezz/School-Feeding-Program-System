import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarCheck, CloudOff, Users, Warehouse } from 'lucide-react';
import { Alert, Badge, Card, DataTable, FormField, PageHeader, StatCard } from '../components/ui';
import { getTermAnalytics } from '../services/api';
import { useDataFreshness } from '../hooks/useDataFreshness';
import { ATTENTION, attention, summary } from '../features/analytics/analyticsData';
import { NOT_FED_REASONS } from '../features/feeding/planning';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useSession } from '../hooks/useSession';
import { formatNumber, formatPercent } from '../utils/format';

/** A figure, marked when it needs attention, with the reason as its label. */
function Figure({ note, children }) {
  return note
    ? <span className="analytics__flag"><Badge tone="warning" icon={AlertTriangle} title={note}>{children}</Badge><span className="visually-hidden"> ({note})</span></span>
    : <span className="tabular-nums">{children}</span>;
}

const days = (n) => `${formatNumber(n)} ${n === 1 ? 'day' : 'days'}`;
const after = (n) => (n === 0 ? 'opening day' : `${days(n)} after opening`);
const ratio = (value) => (value === null || value === undefined ? '–' : value.toFixed(2));

function columns() {
  return [
    { key: 'name', header: 'School', primary: true, render: (s) => s.name },
    {
      key: 'records', header: 'Days recorded',
      render: (s) => (
        <Figure note={s.notes.records}>
          {formatNumber(s.recorded)} of {formatNumber(s.schoolDays)}
          {s.notFed > 0 && ` · ${s.notFed} not fed${s.mainReason ? ` (${(NOT_FED_REASONS[s.mainReason] || s.mainReason).toLowerCase()})` : ''}`}
        </Figure>
      ),
    },
    {
      key: 'coverage', header: 'Learners fed', align: 'end',
      render: (s) => (s.coverage === null ? '–' : `${formatNumber(s.meanFed)} of ${formatNumber(s.enrolled)} (${formatPercent(s.coverage)})`),
    },
    {
      key: 'ration', header: 'Cereals · pulses vs ration', align: 'end',
      render: (s) => (
        <>
          <Figure note={s.notes.cerealsVsRation}>{ratio(s.cerealsVsRation)}</Figure>
          {' · '}
          <Figure note={s.notes.pulsesVsRation}>{ratio(s.pulsesVsRation)}</Figure>
        </>
      ),
    },
    {
      key: 'stock', header: 'Days of food', align: 'end',
      render: (s) => <Figure note={s.notes.daysOfFood}>{s.daysOfFood === null ? '–' : formatNumber(s.daysOfFood)}</Figure>,
    },
    {
      key: 'delivery', header: 'First delivery',
      render: (s) => {
        if (s.programmeType !== 'in_kind') return 'Buys its own food';
        if (!s.firstDelivery) return <Figure note={s.notes.delivery}>None yet</Figure>;
        return (
          <Figure note={s.notes.delivery}>
            {s.firstDelivery} ({after(s.deliveryDaysAfterOpening)}){s.deliveryShortKg > 0 && ` · ${formatNumber(s.deliveryShortKg)} kg short`}
          </Figure>
        );
      },
    },
    {
      key: 'sync', header: 'Last synced',
      render: (s) => <Figure note={s.notes.sync}>{s.lastSync === null ? 'Never' : s.daysSinceSync === 0 ? 'Up to date' : `${days(s.daysSinceSync)} behind`}</Figure>,
    },
  ];
}

/**
 * Term analytics for programme officers: each school's term so far from its synced
 * records (days recorded, coverage, food against the ration, stock, deliveries and
 * when it last synced). Figures outside a stated rule are marked for a look.
 */
function Analytics() {
  const isOnline = useOnlineStatus();
  const { user } = useSession();
  const allowed = user?.role === 'programme_officer';
  const [termId, setTermId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const { refreshKey, markLoaded } = useDataFreshness();
  const ready = allowed && isOnline;

  useEffect(() => {
    if (!ready) return undefined;
    let active = true;
    setData(null);
    setError(null);
    getTermAnalytics({ ...(termId && { termId }) })
      .then((res) => { if (active) { setData(res); markLoaded(res.subCounty); } })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [ready, termId, refreshKey, markLoaded]);

  if (!allowed) {
    return (
      <>
        <PageHeader title="Analytics" />
        <Alert tone="neutral" title="For programme officers">Sub-county analytics are for programme officers.</Alert>
      </>
    );
  }

  const schools = (data?.schools || []).map((s) => ({ ...s, notes: attention(s) }));
  const totals = summary(schools);
  const loading = ready && !data && !error;

  return (
    <>
      <PageHeader
        title="Analytics"
        description={`How each school's term is going, from the records that have synced${data ? `, up to ${data.asOf}` : ''}.`}
      />
      <div className="ui-stack">
        <Card>
          <div className="weekly-review__controls">
            <FormField id="analytics-term" label="Term" as="select" value={termId || data?.term.id || ''}
              onChange={(e) => setTermId(e.target.value)}
              options={(data?.terms || []).map((t) => ({ value: t.id, label: t.label }))} />
          </div>
        </Card>

        {!isOnline && <Alert tone="neutral" title="You are offline">Analytics need a connection.</Alert>}
        {error && <Alert tone="danger" title="Could not load analytics">{error}</Alert>}

        <div className="ui-grid ui-grid--4">
          <StatCard label="School days recorded" icon={CalendarCheck} loading={loading}
            value={formatPercent(totals.recordedShare)} hint={`Across ${formatNumber(totals.schools)} schools`} />
          <StatCard label="Learners fed" icon={Users} loading={loading}
            value={formatPercent(totals.meanCoverage)} hint="Of enrolment, on days with feeding (school average)" />
          <StatCard label="Low on food" icon={Warehouse} loading={loading}
            value={formatNumber(totals.lowStock)} hint={`Schools with under ${ATTENTION.daysOfFood} days of cereals`} />
          <StatCard label="Not synced" icon={CloudOff} loading={loading}
            value={formatNumber(totals.notSynced)} hint={`No records for over ${ATTENTION.syncDays} days`} />
        </div>

        <Card title="Schools" description={data ? `${totals.needAttention} of ${totals.schools} with a figure to look at` : undefined}>
          <DataTable
            columns={columns()}
            rows={schools}
            getRowKey={(s) => s.schoolId}
            caption="Each school's term so far"
            loading={loading}
            emptyState={{ title: 'No schools', description: 'No schools are registered in this sub-county.' }}
          />
          <p className="analytics__rules">
            Marked when: more than {ATTENTION.missingDays} school days have no record; food issued is outside{' '}
            {ATTENTION.rationLow}–{ATTENTION.rationHigh} times the ration for learners fed; fewer than {ATTENTION.daysOfFood} days of
            cereals are left by the records; the first delivery came more than {ATTENTION.deliveryDays} days after opening; or no
            records have synced for over {ATTENTION.syncDays} days. A school whose records have not synced looks quiet everywhere
            else, including the weekly review list, so check the last column first.
          </p>
        </Card>
      </div>
    </>
  );
}

export default Analytics;
