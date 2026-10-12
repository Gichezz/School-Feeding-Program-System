import { useEffect, useMemo, useState } from 'react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { dailyTotals, loadInsights, summarise } from './insightsData';

/**
 * Records, totals and daily figures for a date range ({ start, end }, DD-MM-YYYY).
 * Reloads when the range changes, when the device goes on or offline, and when
 * the sync queue changes (a record saved here, or a sync finishing).
 */
export function useInsights(range) {
  const isOnline = useOnlineStatus();
  const { pendingCount } = useSyncStatus();
  const [state, setState] = useState({ loading: true, data: null });

  useEffect(() => {
    if (!range.start || !range.end) return undefined;
    let cancelled = false;
    setState((current) => ({ ...current, loading: true }));
    loadInsights(range)
      .then((data) => !cancelled && setState({ loading: false, data }))
      .catch(() => !cancelled && setState({ loading: false, data: { attendance: [], meals: [], fromDevice: true, previous: null } }));
    return () => { cancelled = true; };
  }, [range.start, range.end, isOnline, pendingCount]); // the dates, not the range object

  return useMemo(() => {
    const data = state.data;
    if (!data) return { loading: true, attendance: [], meals: [], totals: null, previousTotals: null, daily: [], fromDevice: false };
    const previous = data.previous;
    return {
      loading: state.loading,
      attendance: data.attendance,
      meals: data.meals,
      fromDevice: data.fromDevice,
      totals: summarise(data.attendance, data.meals),
      previousTotals: previous ? summarise(previous.attendance, previous.meals) : null,
      daily: dailyTotals(data.attendance, data.meals),
    };
  }, [state]);
}
