import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarX, CloudOff, Scale, Truck, Warehouse } from 'lucide-react';
import {
  Alert, Badge, Card, ChartCard, DataTable, FormField, PageHeader, PrintButton, PrintHeader, StatusLine, TriageSection,
} from '../components/ui';
import { getTermAnalytics } from '../services/api';
import { useDataFreshness } from '../hooks/useDataFreshness';
import { ATTENTION, attention, summary, triage } from '../features/analytics/analyticsData';
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
const shortName = (name) => name.replace(/ (Primary|Comprehensive|Secondary) School$/, '');

// The reasons, worded for the officer, each with its rule right under the heading
const SECTIONS = {
  cantJudge: {
    icon: CloudOff,
    title: 'Can’t judge yet',
    rule: `Records more than ${ATTENTION.syncDays} days behind (or never sent), or more food recorded as used than received. Their other figures cannot be trusted until this is sorted, so they are not listed below.`,
  },
  daysOfFood: {
    icon: Warehouse,
    title: 'Low on food',
    rule: `Fewer than ${ATTENTION.daysOfFood} school days of cereals left by the records, at the school's recent daily use.`,
  },
  delivery: {
    icon: Truck,
    title: 'Late or no first delivery',
    rule: `Schools that receive food: the first delivery of the term came more than ${ATTENTION.deliveryDays} days after opening, or has not come.`,
  },
  records: {
    icon: CalendarX,
    title: 'Days not recorded',
    rule: `More than ${ATTENTION.missingDays} school days with no feeding record at all.`,
  },
  ration: {
    icon: Scale,
    title: 'Food issued against the ration',
    rule: `Cereals or pulses issued outside ${ATTENTION.rationLow}–${ATTENTION.rationHigh} times the ration for the learners fed.`,
  },
};

const REASON_FILTER = {
  key: 'reason',
  label: 'Show',
  options: [
    { value: 'cantJudge', label: 'Can’t judge yet' },
    { value: 'daysOfFood', label: 'Low on food' },
    { value: 'delivery', label: 'Late delivery' },
    { value: 'records', label: 'Days not recorded' },
    { value: 'ration', label: 'Ration' },
    { value: 'none', label: 'Nothing to look at' },
  ],
};

function columns() {
  return [
    { key: 'name', header: 'School', primary: true, render: (s) => s.name, sortValue: (s) => s.name },
    {
      key: 'records', header: 'Days recorded', sortValue: (s) => s.missing,
      render: (s) => (
        <Figure note={s.notes.records}>
          {formatNumber(s.recorded)} of {formatNumber(s.schoolDays)}
          {s.notFed > 0 && ` · ${s.notFed} not fed${s.mainReason ? ` (${(NOT_FED_REASONS[s.mainReason] || s.mainReason).toLowerCase()})` : ''}`}
        </Figure>
      ),
    },
    {
      key: 'coverage', header: 'Learners fed', align: 'end', sortValue: (s) => s.coverage,
      render: (s) => (s.coverage === null ? '–' : `${formatNumber(s.meanFed)} of ${formatNumber(s.enrolled)} (${formatPercent(s.coverage)})`),
    },
    {
      key: 'cereals', header: 'Cereals vs ration', align: 'end', sortValue: (s) => s.cerealsVsRation,
      render: (s) => <Figure note={s.notes.cerealsVsRation}>{ratio(s.cerealsVsRation)}</Figure>,
    },
    {
      key: 'pulses', header: 'Pulses vs ration', align: 'end', sortValue: (s) => s.pulsesVsRation,
      render: (s) => <Figure note={s.notes.pulsesVsRation}>{ratio(s.pulsesVsRation)}</Figure>,
    },
    {
      key: 'stock', header: 'Days of food', align: 'end', sortValue: (s) => (s.notes.stock ? null : s.daysOfFood),
      render: (s) => (s.notes.stock
        ? <Figure note={s.notes.stock}>Not known</Figure>
        : <Figure note={s.notes.daysOfFood}>{s.daysOfFood === null ? '–' : formatNumber(s.daysOfFood)}</Figure>),
    },
    {
      key: 'delivery', header: 'First delivery', sortValue: (s) => (s.programmeType === 'in_kind' ? (s.deliveryDaysAfterOpening ?? 999) : null),
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
      key: 'sync', header: 'Records sent', sortValue: (s) => (s.lastSync === null ? 9999 : s.daysSinceSync),
      render: (s) => <Figure note={s.notes.sync}>{s.lastSync === null ? 'Never' : s.daysSinceSync === 0 ? 'Up to date' : `${days(s.daysSinceSync)} behind`}</Figure>,
    },
  ];
}

const rowId = (s) => `school-${s.schoolId}`;

/** Jump to a school's row in All schools (its card on a phone) and put focus there. */
function showRow(event, school) {
  event.preventDefault();
  const row = document.getElementById(rowId(school));
  const target = row && row.offsetParent !== null ? row : document.getElementById(`${rowId(school)}-card`);
  target?.scrollIntoView({ block: 'center', behavior: 'instant' });
  target?.focus({ preventScroll: true });
}

/** The schools under one reason, each with the figure that put it there and a link to its row. */
function SchoolList({ schools, figure }) {
  return (
    <ul className="analytics__schools">
      {schools.map((s) => (
        <li key={s.schoolId} className="analytics__school">
          <a href={`#${rowId(s)}`} className="analytics__school-name" onClick={(e) => showRow(e, s)}>{s.name}</a>
          <span className="analytics__school-figure">{figure(s)}</span>
        </li>
      ))}
    </ul>
  );
}

function Triage({ groups }) {
  const daysOfFood = [...groups.daysOfFood].sort((a, b) => a.daysOfFood - b.daysOfFood);
  const lateDelivered = groups.delivery.filter((s) => s.firstDelivery)
    .sort((a, b) => b.deliveryDaysAfterOpening - a.deliveryDaysAfterOpening);
  const records = [...groups.records].sort((a, b) => b.missing - a.missing);
  const reasonsShown = Object.keys(SECTIONS).filter((key) => groups[key].length > 0);

  if (reasonsShown.length === 0) {
    return <StatusLine>No school has a figure outside the rules this term.</StatusLine>;
  }

  return (
    <div className="analytics__triage">
      {groups.cantJudge.length > 0 && (
        <TriageSection {...SECTIONS.cantJudge} tone="warning" count={groups.cantJudge.length}>
          <SchoolList schools={groups.cantJudge} figure={(s) => [s.notes.sync, s.notes.stock].filter(Boolean).join(' · ')} />
        </TriageSection>
      )}
      {daysOfFood.length > 0 && (
        <TriageSection {...SECTIONS.daysOfFood} tone="warning" count={daysOfFood.length}>
          <ChartCard title="School days of cereals left" type="ranked" xKey="school" xLabel="School"
            data={daysOfFood.map((s) => ({ school: shortName(s.name), days: s.daysOfFood }))}
            summary={`${daysOfFood.length} ${daysOfFood.length === 1 ? 'school has' : 'schools have'} under ${ATTENTION.daysOfFood} school days of cereals; ${shortName(daysOfFood[0].name)} has the fewest (${days(daysOfFood[0].daysOfFood)}).`}
            series={[{ dataKey: 'days', metric: 'figure', label: 'School days of cereals' }]}
            referenceLine={{ value: ATTENTION.daysOfFood, label: `Rule: ${ATTENTION.daysOfFood} days` }}
            height={daysOfFood.length > 6 ? 'md' : 'sm'} />
          <SchoolList schools={daysOfFood} figure={(s) => s.notes.daysOfFood} />
        </TriageSection>
      )}
      {groups.delivery.length > 0 && (
        <TriageSection {...SECTIONS.delivery} tone="warning" count={groups.delivery.length}>
          {lateDelivered.length > 0 && (
            <ChartCard title="Days from opening to first delivery" type="ranked" xKey="school" xLabel="School"
              data={lateDelivered.map((s) => ({ school: shortName(s.name), days: s.deliveryDaysAfterOpening }))}
              summary={`${shortName(lateDelivered[0].name)} waited longest: ${days(lateDelivered[0].deliveryDaysAfterOpening)}.`}
              series={[{ dataKey: 'days', metric: 'figure', label: 'Days after opening' }]}
              referenceLine={{ value: ATTENTION.deliveryDays, label: `Rule: ${ATTENTION.deliveryDays} days` }}
              height="sm" />
          )}
          <SchoolList schools={[...lateDelivered, ...groups.delivery.filter((s) => !s.firstDelivery)]} figure={(s) => s.notes.delivery} />
        </TriageSection>
      )}
      {records.length > 0 && (
        <TriageSection {...SECTIONS.records} tone="warning" count={records.length}>
          <SchoolList schools={records} figure={(s) => s.notes.records} />
        </TriageSection>
      )}
      {groups.ration.length > 0 && (
        <TriageSection {...SECTIONS.ration} tone="warning" count={groups.ration.length}>
          <SchoolList schools={groups.ration} figure={(s) => [s.notes.cerealsVsRation, s.notes.pulsesVsRation].filter(Boolean).join(' · ')} />
        </TriageSection>
      )}
    </div>
  );
}

/**
 * Term analytics for programme officers, as a list of what to look at first: schools
 * whose figures cannot be judged yet, then one section per reason with its rule, then
 * every school's figures. Built from the schools' synced records.
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
  const groups = triage(schools);
  const loading = ready && !data && !error;
  const inGroup = Object.fromEntries(Object.entries(groups).map(([key, list]) => [key, new Set(list.map((s) => s.schoolId))]));

  return (
    <div data-density="compact">
      {data && <PrintHeader title="Schools to look at" scope={`${data.subCounty} · ${data.term.label} · figures up to ${data.asOf}`} />}
      <PageHeader
        title="Analytics"
        description={data ? `${data.subCounty} · ${data.term.label} · from the records that have reached the server, up to ${data.asOf}.` : 'How each school’s term is going, from the records that have reached the server.'}
        actions={data && <PrintButton />}
      />
      <div className="ui-stack">
        <div className="analytics__controls no-print">
          <FormField id="analytics-term" label="Term" as="select" value={termId || data?.term.id || ''}
            onChange={(e) => setTermId(e.target.value)}
            options={(data?.terms || []).map((t) => ({ value: t.id, label: t.label }))} />
        </div>

        {!isOnline && <StatusLine icon={CloudOff}>Offline. Analytics need a connection.</StatusLine>}
        {error && <Alert tone="danger" title="Could not load analytics">{error}</Alert>}

        {data && (
          <StatusLine>
            <strong>{formatNumber(totals.schools)} schools</strong> · {formatPercent(totals.recordedShare)} of school days recorded ·{' '}
            {formatPercent(totals.meanCoverage)} of enrolment fed on feeding days (school average)
          </StatusLine>
        )}

        {data && <Triage groups={groups} />}

        <Card title="All schools" description={data ? `${totals.needAttention} of ${totals.schools} with a figure to look at` : undefined}>
          <DataTable
            columns={columns()}
            rows={schools}
            getRowKey={(s) => s.schoolId}
            getRowId={rowId}
            caption="Each school's term so far"
            loading={loading}
            noun="schools"
            stickyFirstColumn
            initialSort={{ key: 'name', direction: 'ascending' }}
            search={{ label: 'Find a school', textOf: (s) => [s.name] }}
            filters={[{
              ...REASON_FILTER,
              matches: (s, value) => (value === 'none' ? Object.keys(s.notes).length === 0 : inGroup[value]?.has(s.schoolId)),
            }]}
            emptyState={{ title: 'No schools', description: 'No schools are registered in this sub-county.' }}
          />
        </Card>
      </div>
    </div>
  );
}

export default Analytics;
