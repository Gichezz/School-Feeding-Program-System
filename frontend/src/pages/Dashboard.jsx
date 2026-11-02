import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, CheckCircle2, CloudAlert, CloudOff, Flag, GitCompareArrows, ListChecks, Users, Warehouse } from 'lucide-react';
import { Alert, Button, Card, EmptyState, FormField, PageHeader, StatCard } from '../components/ui';
import { getReviewWeeks, getSchools, getTermAnalytics } from '../services/api';
import { ATTENTION, attention, summary } from '../features/analytics/analyticsData';
import { recentMondays } from '../features/weeklyReview/weeks';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { useSession } from '../hooks/useSession';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useOpenFlagCount } from '../features/review/useOpenFlagCount';
import { useResolvesConflicts, useServerConflictCount } from '../features/conflicts/useServerConflictCount';
import { formatDateTime, formatNumber, formatPercent } from '../utils/format';

/**
 * Conflicts, held records, flagged records and failed syncs that someone needs to act on.
 */
function NeedsAttention({ decisions, failedCount, failure, openFlags }) {
  const items = [];
  if (decisions > 0) {
    items.push({
      key: 'conflicts',
      icon: GitCompareArrows,
      title: decisions === 1 ? '1 record needs a decision' : `${formatNumber(decisions)} records need a decision`,
      description: "Conflicts between a school's devices and the server, and records held for a decision, such as a delivery note entered twice.",
      action: <Button as={Link} to="/conflicts" variant="secondary" size="sm">Decide</Button>,
    });
  }
  if (openFlags > 0) {
    items.push({
      key: 'review',
      icon: Flag,
      title: openFlags === 1 ? '1 flagged record to check' : `${formatNumber(openFlags)} flagged records to check`,
      description: 'Records that look unusual, such as more learners fed than enrolled, food far from the ration, or a short delivery.',
      action: <Button as={Link} to="/review" variant="secondary" size="sm">Review</Button>,
    });
  }
  if (failedCount > 0 && failure) {
    items.push({
      key: 'failed',
      icon: CloudAlert,
      title: failure.what,
      description: failure.why,
      action: <Button as={Link} to="/sync" variant="secondary" size="sm">Open sync status</Button>,
    });
  }

  return (
    <Card title="Needs attention" description="Decisions waiting for you, and changes that did not sync.">
      {items.length === 0 ? (
        <EmptyState compact icon={CheckCircle2} title="Nothing needs attention" description="Conflicts, held records, flagged records and failed syncs appear here." />
      ) : (
        <ul className="dashboard__attention">
          {items.map(({ key, icon: Icon, title, description, action }) => (
            <li key={key} className="dashboard__attention-item">
              <Icon className="dashboard__attention-icon" aria-hidden="true" />
              <div className="dashboard__attention-text">
                <p className="dashboard__attention-title">{title}</p>
                <p className="dashboard__attention-description">{description}</p>
              </div>
              <div className="dashboard__attention-action">{action}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** This week's review list: scored or not, and how far the officer has got with it. */
function ReviewListCard({ weeks, loading }) {
  const [thisWeek, lastWeek] = useMemo(() => recentMondays(new Date(), 2), []);
  const latest = weeks?.find((w) => w.week === thisWeek) || weeks?.find((w) => w.week === lastWeek) || null;
  const text = (() => {
    if (loading) return 'Loading…';
    if (!latest) return 'This week and last week have not been scored yet.';
    const which = latest.week === thisWeek ? 'This week' : 'Last week';
    if (latest.listed === 0) return `${which}'s list (week of ${latest.week}) has no schools on it.`;
    return `${which}'s list (week of ${latest.week}): ${latest.decided} of ${latest.listed} schools reviewed. Scored ${formatDateTime(latest.scoredAt)}.`;
  })();
  return (
    <Card title="Weekly review list" description="The schools whose records look most unusual this week, to look into first.">
      <div className="dashboard__review">
        <ListChecks className="dashboard__attention-icon" aria-hidden="true" />
        <p className="dashboard__attention-description">{text}</p>
        <Button as={Link} to="/weekly-review" variant="secondary" size="sm">
          {latest && latest.decided < latest.listed ? 'Continue' : 'Open'}
        </Button>
      </div>
    </Card>
  );
}

/**
 * The officer's and administrator's start page: the term so far across the sub-county's
 * schools, the weekly review list, and what needs a decision. Built from the feeding and
 * stock records schools sync; Analytics has each school's figures.
 */
function Dashboard() {
  const isOnline = useOnlineStatus();
  const { isAdmin } = useSession();
  const { failedCount, failure, unresolvedConflicts } = useSyncStatus();
  const openFlags = useOpenFlagCount();
  const resolves = useResolvesConflicts();
  const serverConflicts = useServerConflictCount();
  const [subCounties, setSubCounties] = useState([]);
  const [subCounty, setSubCounty] = useState('');
  const [term, setTerm] = useState(null);
  const [weeks, setWeeks] = useState(null);
  const [error, setError] = useState(null);

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

  const ready = resolves && isOnline && (!isAdmin || subCounty);

  useEffect(() => {
    if (!ready) return undefined;
    let active = true;
    const scope = isAdmin ? { subCounty } : {};
    setTerm(null);
    setWeeks(null);
    setError(null);
    getTermAnalytics(scope).then((res) => { if (active) setTerm(res); }).catch((err) => { if (active) setError(err.message); });
    getReviewWeeks(scope.subCounty).then((res) => { if (active) setWeeks(res.weeks || []); }).catch(() => { if (active) setWeeks([]); });
    return () => { active = false; };
  }, [ready, isAdmin, subCounty]);

  const schools = term?.schools || [];
  const totals = summary(schools);
  const toLookAt = schools.filter((s) => Object.keys(attention(s)).length > 0).length;
  const loading = ready && !term && !error;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={term ? `${term.subCounty}: Term ${term.term.term} ${term.term.year}, up to ${term.asOf}.` : 'The term so far, the weekly review list, and what needs a decision.'}
      />

      <div className="ui-stack">
        {isAdmin && subCounties.length > 1 && (
          <Card>
            <FormField id="dashboard-sub-county" label="Sub-county" as="select" value={subCounty}
              onChange={(e) => setSubCounty(e.target.value)} options={subCounties.map((n) => ({ value: n, label: n }))} />
          </Card>
        )}

        {!isOnline && <Alert tone="neutral" title="You are offline">The term's figures and the review list need a connection.</Alert>}
        {error && <Alert tone="danger" title="Could not load the term's figures">{error}</Alert>}

        <div className="ui-grid ui-grid--4">
          <StatCard label="School days recorded" icon={CalendarCheck} loading={loading}
            value={formatPercent(totals.recordedShare)} hint={`Across ${formatNumber(totals.schools)} schools`} />
          <StatCard label="Learners fed" icon={Users} loading={loading}
            value={formatPercent(totals.meanCoverage)} hint="Of enrolment, on days with feeding" />
          <StatCard label="Low on food" icon={Warehouse} loading={loading}
            value={formatNumber(totals.lowStock)} hint={`Under ${ATTENTION.daysOfFood} days of cereals`} />
          <StatCard label="Not synced" icon={CloudOff} loading={loading}
            value={formatNumber(totals.notSynced)} hint={`No records for over ${ATTENTION.syncDays} days`} />
        </div>

        {term && (
          <Card>
            <div className="dashboard__review">
              <Flag className="dashboard__attention-icon" aria-hidden="true" />
              <p className="dashboard__attention-description">
                {toLookAt === 0
                  ? 'No school has a figure outside the stated rules this term.'
                  : `${toLookAt} of ${schools.length} schools have a figure to look at this term (days not recorded, food against the ration, stock, deliveries or syncing).`}
              </p>
              <Button as={Link} to="/analytics" variant="secondary" size="sm">Open analytics</Button>
            </div>
          </Card>
        )}

        <ReviewListCard weeks={weeks} loading={ready && weeks === null} />

        <NeedsAttention
          decisions={serverConflicts ?? unresolvedConflicts}
          failedCount={failedCount}
          failure={failure}
          openFlags={openFlags}
        />
      </div>
    </>
  );
}

export default Dashboard;
