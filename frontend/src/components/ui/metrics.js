/**
 * Metrics shown in charts and stat cards. Each metric always uses the same chart
 * colour token (see --chart-* in src/styles/tokens.css) on every page.
 */
export const METRICS = {
  fed: { label: 'Learners fed', token: '--chart-1' },
  cereals: { label: 'Cereals', token: '--chart-3' },
  pulses: { label: 'Pulses', token: '--chart-2' },
  figure: { label: 'Figure', token: '--chart-1' },
};

export const METRIC_KEYS = Object.keys(METRICS);
