import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import Card from './Card';
import EmptyState from './EmptyState';
import Skeleton, { LoadingRegion } from './Skeleton';
import { METRICS } from './metrics';
import { useChartTheme } from './chartTheme';
import { formatNumber } from '../../utils/format';

function ChartTooltip({ active, payload, label, series, valueFormatter, labelFormatter }) {
  if (!active || !payload?.length) return null;
  const byKey = Object.fromEntries(payload.map((item) => [item.dataKey, item.value]));
  return (
    <div className="ui-chart__tooltip">
      <p className="ui-chart__tooltip-label">{labelFormatter ? labelFormatter(label) : label}</p>
      <ul className="ui-chart__legend ui-chart__legend--stacked">
        {series.filter((s) => byKey[s.dataKey] !== undefined).map((s) => (
          <li key={s.dataKey} className="ui-chart__legend-item">
            <span className={`ui-swatch ui-swatch--${s.metric}`} aria-hidden="true" />
            {s.label || METRICS[s.metric].label}: <strong>{valueFormatter(byKey[s.dataKey])}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The single wrapper for every chart in Lishe. It applies the design tokens: one
 * colour per metric (see metrics.js), axis and grid styling, tooltip and legend.
 *
 * type: 'line' | 'bar' | 'band'
 *   band: series[0] as a line plus a shaded range between band.lowerKey and band.upperKey
 * series: [{ dataKey, metric: 'attendance' | 'served' | 'prepared' | 'forecast', label? }]
 */
function ChartCard({
  title,
  description,
  actions,
  type = 'line',
  data,
  xKey,
  series,
  band,
  height = 'md',
  loading = false,
  emptyMessage = 'No data for this period yet',
  valueFormatter = formatNumber,
  xTickFormatter,
  labelFormatter,
}) {
  const { colors, bandOpacity } = useChartTheme();
  const hasData = data && data.length > 0;

  let body;
  if (loading) {
    body = (
      <LoadingRegion label={`Loading ${title}`}>
        <Skeleton variant="chart" />
      </LoadingRegion>
    );
  } else if (!hasData) {
    body = <EmptyState compact title={emptyMessage} />;
  } else {
    const axes = [
      <CartesianGrid key="grid" vertical={false} className="ui-chart__grid" />,
      <XAxis key="x" dataKey={xKey} tickFormatter={xTickFormatter} tickLine={false} axisLine={false} minTickGap={16} />,
      // Bars start at zero so their lengths stay honest; lines and ranges zoom to the data
      <YAxis key="y" tickFormatter={valueFormatter} tickLine={false} axisLine={false} width={48} allowDecimals={false} domain={type === 'bar' ? [0, 'auto'] : ['auto', 'auto']} />,
      <Tooltip
        key="tooltip"
        content={<ChartTooltip series={series} valueFormatter={valueFormatter} labelFormatter={labelFormatter} />}
        cursor={{ className: 'ui-chart__cursor' }}
      />,
    ];
    const marks = series.map((s) => (
      type === 'bar'
        ? <Bar key={s.dataKey} dataKey={s.dataKey} name={s.label || METRICS[s.metric].label} fill={colors[s.metric]} radius={[4, 4, 0, 0]} maxBarSize={32} isAnimationActive={false} />
        : <Line key={s.dataKey} type="monotone" dataKey={s.dataKey} name={s.label || METRICS[s.metric].label} stroke={colors[s.metric]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
    ));
    const bandArea = type === 'band' && band && (
      <Area
        key="band"
        dataKey={(row) => [row[band.lowerKey], row[band.upperKey]]}
        stroke="none"
        fill={colors[band.metric || series[0].metric]}
        fillOpacity={bandOpacity}
        isAnimationActive={false}
        activeDot={false}
      />
    );

    body = (
      <figure className={`ui-chart ui-chart--${height}`}>
        <ResponsiveContainer width="100%" height="100%">
          {type === 'line'
            ? <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>{axes}{marks}</LineChart>
            : <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>{axes}{bandArea}{marks}</ComposedChart>}
        </ResponsiveContainer>
        <figcaption className="visually-hidden">{description || title}</figcaption>
      </figure>
    );
  }

  return (
    <Card
      title={title}
      description={description}
      actions={actions}
      footer={hasData && !loading && (
        <ul className="ui-chart__legend">
          {series.map((s) => (
            <li key={s.dataKey} className="ui-chart__legend-item">
              <span className={`ui-swatch ui-swatch--${s.metric}`} aria-hidden="true" />
              {s.label || METRICS[s.metric].label}
            </li>
          ))}
          {type === 'band' && band && (
            <li className="ui-chart__legend-item">
              <span className={`ui-swatch ui-swatch--${band.metric || series[0].metric} ui-swatch--band`} aria-hidden="true" />
              {band.label || 'Likely range'}
            </li>
          )}
        </ul>
      )}
    >
      {body}
    </Card>
  );
}

/**
 * Tiny trend line for StatCard. Same metric colours as ChartCard.
 */
export function Sparkline({ data, dataKey, metric }) {
  const { colors } = useChartTheme();
  if (!data || data.length < 2) return null;
  return (
    <div className="ui-sparkline" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          {/* Scale to the series itself so small day-to-day changes are visible */}
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Line type="monotone" dataKey={dataKey} stroke={colors[metric]} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default ChartCard;
