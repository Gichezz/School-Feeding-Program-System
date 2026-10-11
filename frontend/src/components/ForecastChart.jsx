/**
 * Line chart of forecast meal demand per school day, with the uncertainty
 * interval shaded. Plain SVG; the forecast table on the page carries the exact values.
 */
const WIDTH = 720;
const HEIGHT = 260;
const PAD = { top: 16, right: 16, bottom: 36, left: 52 };

function ForecastChart({ days }) {
  if (!days || days.length === 0) return null;

  const values = days.flatMap((d) => [d.lower_bound, d.upper_bound, d.predicted_demand]).filter((v) => v != null);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const yMin = Math.max(0, Math.floor((min - span * 0.1) / 10) * 10);
  const yMax = Math.ceil((max + span * 0.1) / 10) * 10;

  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (days.length === 1 ? plotWidth / 2 : (i / (days.length - 1)) * plotWidth);
  const y = (v) => PAD.top + plotHeight - ((v - yMin) / (yMax - yMin)) * plotHeight;

  const hasBand = days.every((d) => d.lower_bound != null && d.upper_bound != null);
  const band = hasBand
    ? [
      ...days.map((d, i) => `${x(i)},${y(d.upper_bound)}`),
      ...days.map((d, i) => `${x(i)},${y(d.lower_bound)}`).reverse(),
    ].join(' ')
    : null;
  const line = days.map((d, i) => `${x(i)},${y(d.predicted_demand)}`).join(' ');
  const ticks = [yMin, Math.round((yMin + yMax) / 2), yMax];
  const labelEvery = Math.max(1, Math.ceil(days.length / 6));

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      role="img"
      aria-label={`Forecast meal demand for ${days.length} school days, from ${days[0].date} to ${days[days.length - 1].date}`}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" />
          <text x={PAD.left - 8} y={y(t)} dy="0.35em" textAnchor="end" fontSize="12" fill="var(--color-muted)">
            {t}
          </text>
        </g>
      ))}
      {band && <polygon points={band} fill="var(--color-brand)" opacity="0.15" />}
      <polyline points={line} fill="none" stroke="var(--color-brand)" strokeWidth="2" />
      {days.map((d, i) => (
        <circle key={d.date} cx={x(i)} cy={y(d.predicted_demand)} r="3" fill="var(--color-brand)">
          <title>{`${d.date}: ${d.predicted_demand} meals`}</title>
        </circle>
      ))}
      {days.map((d, i) =>
        i % labelEvery === 0 || i === days.length - 1 ? (
          <text key={`label-${d.date}`} x={x(i)} y={HEIGHT - 12} textAnchor="middle" fontSize="12" fill="var(--color-muted)">
            {d.date.slice(0, 5)}
          </text>
        ) : null
      )}
    </svg>
  );
}

export default ForecastChart;
