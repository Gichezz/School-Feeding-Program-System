import { CalendarCheck, CloudUpload, Trash2, Utensils } from 'lucide-react';
import { StatCard } from '../../components/ui';
import { formatNumber, formatPercent } from '../../utils/format';
import { changeFrom } from './insightsData';

/**
 * The four headline figures shared by the Dashboard and Reports.
 */
function InsightStatCards({ totals, previousTotals, daily, pendingCount, loading }) {
  // Compare only with a previous period that has records of the same kind
  const before = (field, records) => (previousTotals?.[records] > 0 ? previousTotals[field] : null);
  const trend = daily.length > 1 ? daily : null;

  return (
    <div className="ui-grid ui-grid--4">
      <StatCard
        label="Attendance rate"
        icon={CalendarCheck}
        metric="attendance"
        loading={loading}
        value={totals?.rate === null || !totals ? '–' : formatPercent(totals.rate)}
        hint={totals ? `${formatNumber(totals.present)} of ${formatNumber(totals.registered)} learners` : undefined}
        delta={totals && changeFrom(totals.rate, before('rate', 'attendanceRecords'), { points: true })}
        sparkline={trend && { data: trend.filter((d) => d.rate !== null), dataKey: 'rate', metric: 'attendance' }}
      />
      <StatCard
        label="Meals served"
        icon={Utensils}
        metric="served"
        loading={loading}
        value={formatNumber(totals?.served)}
        hint={totals ? `of ${formatNumber(totals.prepared)} prepared` : undefined}
        delta={totals && changeFrom(totals.served, before('served', 'mealRecords'))}
        sparkline={trend && { data: trend, dataKey: 'served', metric: 'served' }}
      />
      <StatCard
        label="Waste"
        icon={Trash2}
        metric="prepared"
        loading={loading}
        value={formatNumber(totals?.waste)}
        hint="Meals prepared − served"
        delta={totals && changeFrom(totals.waste, before('waste', 'mealRecords'), { higherIsGood: false })}
        sparkline={trend && { data: trend, dataKey: 'waste', metric: 'prepared' }}
      />
      <StatCard
        label="Pending sync"
        icon={CloudUpload}
        value={formatNumber(pendingCount)}
        hint={pendingCount > 0 ? 'Changes waiting on this device' : 'Nothing waiting to sync'}
      />
    </div>
  );
}

export default InsightStatCards;
