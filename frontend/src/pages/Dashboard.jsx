import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarX, ClipboardCheck, CloudOff, Flag, GitCompareArrows, ListChecks, PieChart } from 'lucide-react';
import { Alert, Card, StatusLine, WorkQueue } from '../components/ui';
import StockTable from '../features/analytics/StockTable';
import { getCalendarStatus, getEnrolmentChecks, getReviewWeeks, getTermAnalytics } from '../services/api';
import { useDataFreshness } from '../hooks/useDataFreshness';
import SystemDashboard from '../features/system/SystemDashboard';
import { attention, summary, triage } from '../features/analytics/analyticsData';
import { TO_CHECK } from '../features/enrolment/checkStatus';
import { recentMondays } from '../features/weeklyReview/weeks';
import { useSession } from '../hooks/useSession';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useOpenFlagCount } from '../features/review/useOpenFlagCount';
import { useResolvesConflicts, useServerConflictCount } from '../features/conflicts/useServerConflictCount';
import { formatNumber, formatPercent } from '../utils/format';

const QUEUE_ORDER = ['enrolment', 'conflicts', 'flags', 'cantJudge', 'weekly'];
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
  const [calendarEnded, setCalendarEnded] = useState(false);
  const { refreshKey, markLoaded } = useDataFreshness();
  const ready = resolves && isOnline;

  useEffect(() => {
    if (!ready) return undefined;
    let active = true;
    setError(null);
    getTermAnalytics().then((res) => { if (active) { setTerm(res); markLoaded(res.subCounty); } }).catch((err) => { if (active) setError(err.message); });
    getReviewWeeks().then((res) => { if (active) setWeeks(res.weeks || []); }).catch(() => { if (active) setWeeks([]); });
    getEnrolmentChecks().then((res) => { if (active) setEnrolment(res.schools || []); }).catch(() => { if (active) setEnrolment(null); });
    getCalendarStatus().then((res) => { if (active) setCalendarEnded(Boolean(res.calendarEnded)); }).catch(() => {});
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
  ]
    // Work waiting comes first, the most pressing at the top; finished rows sink to the bottom
    .sort((a, b) => Number(Boolean(a.done)) - Number(Boolean(b.done)) || QUEUE_ORDER.indexOf(a.key) - QUEUE_ORDER.indexOf(b.key));

  // The week in sentences: what has happened to the term, and the one thing waiting most
  const termName = term?.term.label;
  const zeroDays = schools.filter((s) => s.daysOfFood === 0).length;
  const headline = (() => {
    if (!term) return 'Your work for the sub-county';
    const state = term.term.closed ? `${termName} has closed.` : `${termName} is under way.`;
    if (enrolmentToCheck > 0) return `${state} ${count(enrolmentToCheck, 'enrolment check is', 'enrolment checks are')} waiting for you.`;
    if (serverConflicts > 0) return `${state} ${count(serverConflicts, 'record needs', 'records need')} a decision.`;
    if (openFlags > 0) return `${state} ${count(openFlags, 'flagged record is', 'flagged records are')} waiting for you.`;
    return `${state} Nothing is waiting for you.`;
  })();
  const detail = !term ? null : term.term.closed
    ? `The figures below are final for the term.${zeroDays > 0 ? ` ${count(zeroDays, 'school', 'schools')} ended it with no cereals left in the store, so ${zeroDays === 1 ? 'it needs' : 'they need'} a delivery before next term opens.` : ''}`
    : totals.lowStock > 0
      ? `${count(totals.lowStock, 'school', 'schools')} will run out of cereals before the term ends, at the rate ${totals.lowStock === 1 ? 'it is' : 'they are'} using food now.`
      : 'Every school has enough cereals for the rest of the term, at the rate it is using food now.';

  useEffect(() => { document.title = 'Dashboard · Lishe'; }, []);

  return (
    <div data-density="compact" className="officer-home">
      <header className="page-band">
        <p className="page-band__eyebrow">{term ? `${term.subCounty} · ${termName}${term.term.closed ? ' (closed)' : ''}` : 'Dashboard'}</p>
        <h1 className="page-band__title">{headline}</h1>
        {detail && <p className="page-band__detail">{detail}</p>}
      </header>

      <div className="ui-stack">
        {!isOnline && <StatusLine icon={CloudOff}>Offline. Your work list needs a connection.</StatusLine>}
        {error && <Alert tone="danger" title="Could not load the term's figures">{error}</Alert>}
        {calendarEnded && (
          <StatusLine icon={CalendarX} tone="warning">
            <strong>The next term&apos;s dates are not in Lishe yet.</strong> Days left and food planning start again once the next term is in.
          </StatusLine>
        )}

        <div className="officer-home__split">
          <section aria-labelledby="todo-h" className="officer-home__todo">
            <h2 id="todo-h" className="officer-home__h">To do</h2>
            <WorkQueue items={items} loading={ready && weeks === null && !error} label="Work waiting for you" />
          </section>

          <section aria-labelledby="term-h" className="officer-home__term">
            <h2 id="term-h" className="officer-home__h">The term in three lines</h2>
            {term && (
              <>
                <p className="officer-home__line"><b>{formatNumber(totals.schools)}</b> schools, {formatPercent(totals.recordedShare)} of school days recorded.</p>
                <p className="officer-home__line"><b>{formatPercent(totals.meanCoverage)}</b> of enrolled learners fed on feeding days, on average.</p>
                <p className="officer-home__line">
                  {term.term.closed
                    ? <><b>{formatNumber(zeroDays)}</b> {zeroDays === 1 ? 'school' : 'schools'} with no cereals left at the close.</>
                    : <><b>{formatNumber(totals.lowStock)}</b> {totals.lowStock === 1 ? 'school' : 'schools'} short of food for the rest of the term.</>}
                </p>
              </>
            )}
          </section>
        </div>

        {term && (
          <Card
            title={term.term.closed ? 'Cereals in each store at the close of term' : 'Cereals in each store'}
            description={term.term.closed
              ? 'The term has closed, so none of these is marked: this is what each store carries into next term.'
              : 'School days of food at each school’s recent daily use, against the school days left in the term.'}
            actions={<Link to="/analytics" className="ui-button ui-button--ghost ui-button--sm"><PieChart className="ui-button__icon" aria-hidden="true" />All figures in Analytics</Link>}
          >
            <StockTable schools={schools} caption="Cereals in store and school days of food, by school" />
          </Card>
        )}
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
