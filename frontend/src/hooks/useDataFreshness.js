import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

const DataFreshnessContext = createContext(null);

/**
 * How current the figures on an officer's screen are. Pages that load data from the
 * server call markLoaded() when it arrives; the top bar shows "Data as of HH:MM" and a
 * Refresh button that bumps refreshKey, which those pages add to their load effect.
 * Nothing new is fetched by this hook itself.
 */
function useDataFreshnessSource() {
  const { pathname } = useLocation();
  const [loadedAt, setLoadedAt] = useState(null);
  const [scope, setScope] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  // A new page starts without a time until its own data has loaded
  useEffect(() => setLoadedAt(null), [pathname]);

  // scope: whose schools the figures cover (e.g. the sub-county), when the data says so
  const markLoaded = useCallback((loadedScope) => {
    setLoadedAt(new Date());
    if (loadedScope) setScope(loadedScope);
  }, []);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  return useMemo(() => ({ loadedAt, scope, refreshKey, markLoaded, refresh }), [loadedAt, scope, refreshKey, markLoaded, refresh]);
}

export function DataFreshnessProvider({ children }) {
  return createElement(DataFreshnessContext.Provider, { value: useDataFreshnessSource() }, children);
}

const OUTSIDE = { loadedAt: null, scope: '', refreshKey: 0, markLoaded: () => {}, refresh: () => {} };

/** Safe to call outside the provider (it then does nothing). */
export function useDataFreshness() {
  return useContext(DataFreshnessContext) || OUTSIDE;
}
