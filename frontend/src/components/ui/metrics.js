/**
 * Metrics shown in charts and stat cards. Each metric always uses the same chart
 * colour token (see --chart-* in src/styles/tokens.css) on every page.
 */
export const METRICS = {
  attendance: { label: 'Present', token: '--chart-1' },
  served: { label: 'Meals served', token: '--chart-2' },
  prepared: { label: 'Meals prepared', token: '--chart-3' },
  forecast: { label: 'Forecast meals', token: '--chart-4' },
};

export const METRIC_KEYS = Object.keys(METRICS);
