import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, CloudOff, Flag, GitCompareArrows, ListChecks, PieChart } from 'lucide-react';
import { Alert, Card, PageHeader, StatusLine, WorkQueue } from '../components/ui';
import { getEnrolmentChecks, getReviewWeeks, getTermAnalytics } from '../services/api';
import { useDataFreshness } from '../hooks/useDataFreshness';
import SystemDashboard from '../features/system/SystemDashboard';
import { ATTENTION, attention, summary, triage } from '../features/analytics/analyticsData';
import { TO_CHECK } from '../features/enrolment/checkStatus';
import { recentMondays } from '../features/weeklyReview/weeks';
import { useSession } from '../hooks/useSession';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useOpenFlagCount } from '../features/review/useOpenFlagCount';
import { useResolvesConflicts, useServerConflictCount } from '../features/conflicts/useServerConflictCount';
import { formatNumber, formatPercent } from '../utils/format';

const count = (n, one, many) => `${formatNumber(n)} ${n === 1 ? one : many}`;

/** This week's review list (or last week's if this week is not scored yet). */
function latestWeek(weeks) {
  const [thisWeek, lastWeek] = recentMondays(new Date(), 2);
  const latest = weeks?.find((w) => w.week === thisWeek) || weeks?.find((w) => w.week === lastWeek) || null;
  return latest && { ...latest, which: latest.week === thisWeek ? 'This week' : 'Last week' };
}

/**
 * The programme officer's start page: the work waiting for them, one row per kind,
 * with where to do it, and a few figures for the term. Every count comes from data
 * the server already gives; a row whose count is not known yet just links to the page.
 */
function ProgrammeDashboard() {
  const isOnline = useOnlineStatus();
  const openFlags = useOpenFlagCount();
  const resolves = useResolvesConflicts();
  const serverConflicts = useServerConflictCount();
  const [term, setTerm] = useState(null);
  const [weeks, setWeeks] = useState(null);
  const [enrolment, setEnrolment] = useState(null);
  const [error, setError] = useState(null);
  const { refreshKey, markLoaded } = useDataFreshness();
  const ready = resolves && isOnline;

  useEffect(() => {
    if (!ready) return undefined;
    let active = true;
    setError(null);
    getTermAnalytics().then((res) => { if (active) { setTerm(res); markLoaded(res.subCounty); } }).catch((err) => { if (active) setError(err.message); });
    getReviewWeeks().then((res) => { if (active) setWeeks(res.weeks || []); }).catch(() => { if (active) setWeeks([]); });
    getEnrolmentChecks().then((res) => { if (active) setEnrolment(res.schools || []); }).catch(() => { if (active) setEnrolment(null); });
    return () => { active = false; };
  }, [ready, refreshKey, markLoaded]);

  const schools = useMemo(() => (term?.schools || []).map((s) => ({ ...s, notes: attention(s) })), [term]);
  const totals = summary(schools);
  const groups = triage(schools);
  const week = latestWeek(weeks);
  const enrolmentToCheck = enrolment ? enrolment.filter((s) => TO_CHECK.includes(s.status)).length : null;
  const loading = ready && !term && !error;

  const items = [
    {
      key: 'conflicts', icon: GitCompareArrows, to: '/conflicts',
      ...(serverConflicts == null
        ? { title: 'Conflicts', description: 'Records changed on two devices.', actionLabel: 'Open' }
        : serverConflicts > 0
          ? { title: count(serverConflicts, 'record to decide', 'records to decide'), description: 'Changed on two devices. Choose which to keep.' }
          : { title: 'No records to decide', done: true }),
    },
    {
      key: 'flags', icon: Flag, to: '/review',
      ...(openFlags == null
        ? { title: 'Record review', description: 'Records that look unusual.', actionLabel: 'Open' }
        : openFlags > 0
          ? { title: count(openFlags, 'flagged record to check', 'flagged records to check'), description: 'Check each against the register or store book.' }
          : { title: 'No flagged records to check', done: true }),
    },
    {
      key: 'weekly', icon: ListChecks, to: '/weekly-review',
      ...(!week
        ? { title: 'Weekly review', description: 'This week and last week have not been scored yet.', actionLabel: 'Open' }
        : week.listed === 0
          ? { title: `${week.which}'s list has no schools on it`, done: true }
          : week.decided < week.listed
            ? { title: `${week.which}'s list: ${week.decided} of ${week.listed} schools reviewed`, progress: { done: week.decided, total: week.listed } }
            : { title: `${week.which}'s list: all ${week.listed} schools reviewed`, done: true }),
    },
    {
      key: 'enrolment', icon: ClipboardCheck, to: '/enrolment-checks',
      ...(enrolmentToCheck === null
        ? { title: 'Enrolment checks', description: 'Each school’s termly enrolment, to verify against the register.', actionLabel: 'Open' }
        : enrolmentToCheck > 0
          ? { title: count(enrolmentToCheck, 'school’s enrolment to check', 'schools’ enrolment to check'), description: 'It sets the food a school can request.' }
          : { title: 'No enrolment to check', done: true }),
    },
    ...(term ? [{
      key: 'cantJudge', icon: CloudOff, to: '/analytics',
      ...(groups.cantJudge.length > 0
        ? { title: count(groups.cantJudge.length, 'school can’t be judged yet', 'schools can’t be judged yet'), description: 'Records behind, or stock records incomplete.', actionLabel: 'See which' }
        : { title: 'Every school’s records are up to date', done: true }),
    }] : []),
  ];

  return (
    <div data-density="compact">
      <PageHeader
        title="Dashboard"
        description={term ? `${term.subCounty} · ${term.term.label} · figures up to ${term.asOf}` : 'The work waiting for you, and the term so far.'}
      />

      <div className="ui-stack">
        {!isOnline && <StatusLine icon={CloudOff}>Offline. Your work list needs a connection.</StatusLine>}
        {error && <Alert tone="danger" title="Could not load the term's figures">{error}</Alert>}

        <Card title="To do">
          <WorkQueue items={items} loading={ready && weeks === null && !error} label="Work waiting for you" />
        </Card>

        <Card title="The term so far" description={term ? `${term.term.label}, across ${count(totals.schools, 'school', 'schools')}` : undefined}
          actions={<Link to="/analytics" className="ui-button ui-button--secondary ui-button--sm"><PieChart className="ui-button__icon" aria-hidden="true" />Open analytics</Link>}>
          {loading ? null : term && (
            <dl className="dashboard__snapshot">
              <div className="dashboard__figure">
                <dt>School days recorded</dt>
                <dd className="tabular-nums">{formatPercent(totals.recordedShare)}</dd>
              </div>
              <div className="dashboard__figure">
                <dt>Learners fed, of enrolment</dt>
                <dd className="tabular-nums">{formatPercent(totals.meanCoverage)}</dd>
              </div>
              <div className="dashboard__figure">
                <dt>Low on food (under {ATTENTION.daysOfFood} days)</dt>
                <dd className="tabular-nums">{count(totals.lowStock, 'school', 'schools')}</dd>
              </div>
            </dl>
          )}
        </Card>
      </div>
    </div>
  );
}

/**
 * Start page. System administrators see accounts and devices (no school records);
 * programme officers see the work waiting for them.
 */
function Dashboard() {
  const { isAdmin } = useSession();
  return isAdmin ? <SystemDashboard /> : <ProgrammeDashboard />;
}

export default Dashboard;
