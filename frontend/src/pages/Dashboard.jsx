import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, CloudAlert, Flag, GitCompareArrows } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  ChartCard,
  DateRangeFilter,
  EmptyState,
  PageHeader,
  rangeForPreset,
} from '../components/ui';
import InsightStatCards from '../features/insights/InsightStatCards';
import { useInsights } from '../features/insights/useInsights';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { useSession } from '../hooks/useSession';
import { useOpenFlagCount } from '../features/review/useOpenFlagCount';
import { formatNumber, formatPercent } from '../utils/format';

const shortDate = (date) => date.slice(0, 5);
const percent = (value) => formatPercent(value, { isRatio: false });

/**
 * Conflicts, failed syncs and flagged records that someone needs to act on.
 */
function NeedsAttention({ unresolvedConflicts, failedCount, failure, openFlags, isAdmin }) {
  const items = [];
  if (unresolvedConflicts > 0) {
    items.push({
      key: 'conflicts',
      icon: GitCompareArrows,
      title: unresolvedConflicts === 1 ? '1 record needs a decision' : `${formatNumber(unresolvedConflicts)} records need a decision`,
      description: 'The same record was changed on this device and on the server.',
      action: isAdmin
        ? <Button as={Link} to="/conflicts" variant="secondary" size="sm">Resolve</Button>
        : <span className="dashboard__attention-note">An administrator will resolve these.</span>,
    });
  }
  if (isAdmin && openFlags > 0) {
    items.push({
      key: 'review',
      icon: Flag,
      title: openFlags === 1 ? '1 flagged record to check' : `${formatNumber(openFlags)} flagged records to check`,
      description: 'Records that look unusual, such as late entries or more meals served than learners present.',
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
    <Card title="Needs attention" description="Conflicts and changes that did not sync.">
      {items.length === 0 ? (
        <EmptyState compact icon={CheckCircle2} title="Nothing needs attention" description="Conflicts and failed syncs will appear here." />
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

/**
 * Overview of attendance, meals and sync for a chosen period.
 */
function Dashboard() {
  const [range, setRange] = useState(() => ({ preset: '7days', ...rangeForPreset('7days') }));
  const { loading, totals, previousTotals, daily, fromDevice } = useInsights(range);
  const { pendingCount, failedCount, failure, unresolvedConflicts } = useSyncStatus();
  const { isAdmin } = useSession();
  const openFlags = useOpenFlagCount();

  return (
    <>
      <PageHeader title="Dashboard" description="Attendance, meals and sync at a glance." />

      <div className="ui-stack">
        <Card>
          <DateRangeFilter value={range} onChange={setRange} />
        </Card>

        {fromDevice && !loading && (
          <Alert tone="neutral" title="Showing records on this device">
            The server could not be reached, so these figures only include records saved here.
          </Alert>
        )}

        <InsightStatCards
          totals={totals}
          previousTotals={previousTotals}
          daily={daily}
          pendingCount={pendingCount}
          loading={loading}
        />

        <div className="ui-grid ui-grid--2">
          <ChartCard
            title="Attendance trend"
            description="Share of registered learners present each day"
            type="line"
            data={daily.filter((day) => day.rate !== null)}
            xKey="date"
            xTickFormatter={shortDate}
            series={[{ dataKey: 'rate', metric: 'attendance', label: 'Attendance rate' }]}
            valueFormatter={percent}
            loading={loading}
          />
          <ChartCard
            title="Prepared vs served"
            description="Meals each day; the gap is waste"
            type="bar"
            data={daily.filter((day) => day.prepared > 0 || day.served > 0)}
            xKey="date"
            xTickFormatter={shortDate}
            series={[{ dataKey: 'prepared', metric: 'prepared' }, { dataKey: 'served', metric: 'served' }]}
            loading={loading}
          />
        </div>

        <NeedsAttention
          unresolvedConflicts={unresolvedConflicts}
          failedCount={failedCount}
          failure={failure}
          openFlags={openFlags}
          isAdmin={isAdmin}
        />
      </div>
    </>
  );
}

export default Dashboard;
