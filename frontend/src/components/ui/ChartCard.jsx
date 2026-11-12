import { useId, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Table2 } from 'lucide-react';
import Button from './Button';
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

/** The same figures as the chart, as a table (for screen readers, print and anyone who prefers it). */
function ChartTable({ data, xKey, xLabel, series, valueFormatter, labelFormatter, caption, scroll = true }) {
  const table = (
      <table className="ui-table__table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{xLabel}</th>
            {series.map((s) => (
              <th key={s.dataKey} scope="col" className="ui-table__cell--end">{s.label || METRICS[s.metric].label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row[xKey]}>
              <th scope="row">{labelFormatter ? labelFormatter(row[xKey]) : row[xKey]}</th>
              {series.map((s) => (
                <td key={s.dataKey} className="ui-table__cell--end tabular-nums">{valueFormatter(row[s.dataKey])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
  );
  // A scrolling box takes a Tab stop, so only the visible table gets one
  return scroll ? <div className="ui-table__scroll">{table}</div> : table;
}

/**
 * The single wrapper for every chart in Lishe. It applies the design tokens: one
 * colour per metric (see metrics.js), axis and grid styling, tooltip and legend.
 * Every chart says in words what it shows (`summary`) and can be shown as a table,
 * so nothing depends on reading the colours or shapes.
 *
 * type: 'line' | 'bar' | 'ranked'
 *   ranked: horizontal bars, one per category, with each value written at the bar's end
 * series: [{ dataKey, metric, label? }]
 * referenceLine: { value, label } — a rule's threshold, drawn as a labelled dashed line
 * xLabel: the heading of the first column when shown as a table
 */
function ChartCard({
  title,
  description,
  summary,
  actions,
  type = 'line',
  data,
  xKey,
  xLabel = 'Date',
  series,
  referenceLine,
  height = 'md',
  loading = false,
  emptyMessage = 'No data for this period yet',
  valueFormatter = formatNumber,
  xTickFormatter,
  labelFormatter,
}) {
  const { colors, rule } = useChartTheme();
  const [asTable, setAsTable] = useState(false);
  const tableId = useId();
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
    const tooltip = (
      <Tooltip
        content={<ChartTooltip series={series} valueFormatter={valueFormatter} labelFormatter={labelFormatter} />}
        cursor={{ className: 'ui-chart__cursor' }}
      />
    );
    const ruleLine = referenceLine && (
      <ReferenceLine
        {...(type === 'ranked' ? { x: referenceLine.value } : { y: referenceLine.value })}
        stroke={rule}
        strokeDasharray="6 4"
        strokeWidth={2}
        ifOverflow="extendDomain"
        label={{ value: referenceLine.label, position: type === 'ranked' ? 'top' : 'insideTopRight', className: 'ui-chart__rule-label' }}
      />
    );

    let chart;
    if (type === 'ranked') {
      // One bar per category, longest first is the caller's job (sort the data)
      chart = (
        <BarChart data={data} layout="vertical" margin={{ top: 20, right: 48, bottom: 0, left: 0 }}>
          <CartesianGrid horizontal={false} className="ui-chart__grid" />
          <XAxis type="number" tickFormatter={valueFormatter} tickLine={false} axisLine={false} domain={[0, 'auto']} />
          <YAxis type="category" dataKey={xKey} tickFormatter={xTickFormatter} tickLine={false} axisLine={false} width={128} />
          {tooltip}
          {ruleLine}
          {series.map((s) => (
            <Bar key={s.dataKey} dataKey={s.dataKey} name={s.label || METRICS[s.metric].label} fill={colors[s.metric]} radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false}>
              <LabelList dataKey={s.dataKey} position="right" formatter={valueFormatter} className="ui-chart__value-label" />
            </Bar>
          ))}
        </BarChart>
      );
    } else {
      const axes = [
        <CartesianGrid key="grid" vertical={false} className="ui-chart__grid" />,
        <XAxis key="x" dataKey={xKey} tickFormatter={xTickFormatter} tickLine={false} axisLine={false} minTickGap={16} />,
        // Bars start at zero so their lengths stay honest; lines zoom to the data
        <YAxis key="y" tickFormatter={valueFormatter} tickLine={false} axisLine={false} width={48} allowDecimals={false} domain={type === 'bar' ? [0, 'auto'] : ['auto', 'auto']} />,
      ];
      const marks = series.map((s) => (
        type === 'bar'
          ? <Bar key={s.dataKey} dataKey={s.dataKey} name={s.label || METRICS[s.metric].label} fill={colors[s.metric]} radius={[4, 4, 0, 0]} maxBarSize={32} isAnimationActive={false} />
          : <Line key={s.dataKey} type="monotone" dataKey={s.dataKey} name={s.label || METRICS[s.metric].label} stroke={colors[s.metric]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
      ));
      chart = type === 'line'
        ? <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>{axes}{tooltip}{ruleLine}{marks}</LineChart>
        : <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>{axes}{tooltip}{ruleLine}{marks}</BarChart>;
    }

    body = (
      <>
        {summary && <p className="ui-chart__summary">{summary}</p>}
        {asTable ? (
          <div id={tableId}>
            <ChartTable data={data} xKey={xKey} xLabel={xLabel} series={series} valueFormatter={valueFormatter}
              labelFormatter={labelFormatter} caption={title} />
          </div>
        ) : (
          <figure className={`ui-chart ui-chart--${height}`} aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
          </figure>
        )}
        {/* Screen readers always get the table; the drawing is hidden from them */}
        {!asTable && (
          <div className="visually-hidden ui-chart__sr-table">
            <ChartTable data={data} xKey={xKey} xLabel={xLabel} series={series} valueFormatter={valueFormatter}
              labelFormatter={labelFormatter} caption={title} scroll={false} />
          </div>
        )}
        <div className="ui-chart__table-toggle no-print">
          <Button variant="ghost" size="sm" icon={Table2} aria-expanded={asTable} aria-controls={asTable ? tableId : undefined}
            onClick={() => setAsTable((v) => !v)}>
            {asTable ? 'Show as chart' : 'Show as table'}
          </Button>
        </div>
      </>
    );
  }

  return (
    <Card
      title={title}
      description={description}
      actions={actions}
      footer={hasData && !loading && !asTable && (series.length > 1 || referenceLine) && (
        <ul className="ui-chart__legend">
          {series.length > 1 && series.map((s) => (
            <li key={s.dataKey} className="ui-chart__legend-item">
              <span className={`ui-swatch ui-swatch--${s.metric}`} aria-hidden="true" />
              {s.label || METRICS[s.metric].label}
            </li>
          ))}
          {referenceLine && (
            <li className="ui-chart__legend-item">
              <span className="ui-swatch ui-swatch--rule" aria-hidden="true" />
              {referenceLine.label}
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
