import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import Skeleton from './Skeleton';
import { Sparkline } from './ChartCard';

/**
 * Headline number with an optional change and trend sparkline.
 *
 * delta: { value: string, direction: 'up' | 'down' | 'flat', good?: boolean, label? }
 *   `good` decides the colour (an increase in waste is not good).
 * sparkline: { data, dataKey, metric }
 * metric: colours the accent bar with the metric's chart colour.
 */
function StatCard({ label, value, hint, delta, sparkline, metric, icon: Icon, loading = false }) {
  const DeltaIcon = delta && { up: TrendingUp, down: TrendingDown, flat: Minus }[delta.direction];
  const deltaTone = !delta || delta.direction === 'flat' ? 'neutral' : delta.good ? 'success' : 'danger';

  return (
    <div className={`ui-stat ${metric ? `ui-stat--${metric}` : ''}`.trim()}>
      <div className="ui-stat__head">
        <p className="ui-stat__label">{label}</p>
        {Icon && <Icon className="ui-stat__icon" aria-hidden="true" />}
      </div>
      {loading ? (
        <Skeleton variant="stat" />
      ) : (
        <>
          <p className="ui-stat__value tabular-nums">{value}</p>
          <div className="ui-stat__foot">
            {delta && (
              <span className={`ui-stat__delta ui-stat__delta--${deltaTone}`}>
                <DeltaIcon className="ui-stat__delta-icon" aria-hidden="true" />
                <span className="ui-stat__delta-value">{delta.value}</span>
                {delta.label && <span className="ui-stat__delta-label"> {delta.label}</span>}
              </span>
            )}
            {hint && <span className="ui-stat__hint">{hint}</span>}
          </div>
          {sparkline && <Sparkline {...sparkline} />}
        </>
      )}
    </div>
  );
}

export default StatCard;
