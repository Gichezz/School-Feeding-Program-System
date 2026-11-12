import { useMemo } from 'react';
import { METRICS } from './metrics';

/**
 * Resolve the chart tokens in tokens.css (--chart-* colours and the rule line) to
 * concrete values for Recharts, which writes them onto SVG attributes.
 */
export function useChartTheme() {
  return useMemo(() => {
    const styles = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    const read = (token, fallback) => styles?.getPropertyValue(token).trim() || fallback;
    return {
      colors: Object.fromEntries(
        Object.entries(METRICS).map(([key, metric]) => [key, read(metric.token, `var(${metric.token})`)])
      ),
      rule: read('--chart-rule', 'var(--chart-rule)'),
    };
  }, []);
}
