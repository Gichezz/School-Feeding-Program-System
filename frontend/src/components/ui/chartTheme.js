import { useMemo } from 'react';
import { METRICS } from './metrics';

/**
 * Resolve the chart tokens in tokens.css (--chart-* colours and the band opacity)
 * to concrete values for Recharts, which writes them onto SVG attributes.
 */
export function useChartTheme() {
  return useMemo(() => {
    const styles = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    const read = (token, fallback) => styles?.getPropertyValue(token).trim() || fallback;
    return {
      colors: Object.fromEntries(
        Object.entries(METRICS).map(([key, metric]) => [key, read(metric.token, `var(${metric.token})`)])
      ),
      bandOpacity: Number(read('--chart-band-opacity', '0.18')),
    };
  }, []);
}
