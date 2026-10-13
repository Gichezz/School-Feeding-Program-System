import { Routes, Route } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import AppShell from './components/shell/AppShell';
import AuthLayout from './components/shell/AuthLayout';
import Dashboard from './pages/Dashboard';
import Attendance from './pages/Attendance';
import MealDistribution from './pages/MealDistribution';
import SyncStatus from './pages/SyncStatus';
import Conflicts from './pages/Conflicts';
import Reports from './pages/Reports';
import Forecast from './pages/Forecast';
import Login from './pages/Login';
import ActivateDevice from './pages/ActivateDevice';
import { useSession } from './hooks/useSession';
import Settings from './pages/Settings';
import { setupAutoSync } from './sync/syncManager';

// Design system reference; only included in development builds
const Styleguide = import.meta.env.DEV ? lazy(() => import('./pages/Styleguide')) : null;
const styleguideRoute = Styleguide && (
  <Route path="/styleguide" element={<Suspense fallback={null}><Styleguide /></Suspense>} />
);

/**
 * Root application routes.
 * Domain features remain placeholders until later phases.
 */
function App() {
  const { session } = useSession();

  useEffect(() => {
    // Setup automatic sync when connectivity returns
    const cleanupAutoSync = setupAutoSync();
    
    return () => {
      // Cleanup auto-sync event listeners when app unmounts
      if (cleanupAutoSync) {
        cleanupAutoSync();
      }
    };
  }, []);

  // Nobody has signed in on this device yet: every route shows the sign-in page
  if (!session) {
    return (
      <Routes>
        {styleguideRoute}
        <Route element={<AuthLayout />}>
          <Route path="/activate" element={<ActivateDevice />} />
          <Route path="*" element={<Login />} />
        </Route>
      </Routes>
    );
  }

  return (
    <Routes>
      {styleguideRoute}
      <Route element={<AppShell />}>
        <Route path="/login" element={<Login />} />
        <Route path="/activate" element={<ActivateDevice />} />
        <Route path="/" element={<Dashboard />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/meals" element={<MealDistribution />} />
        <Route path="/sync" element={<SyncStatus />} />
        <Route path="/conflicts" element={<Conflicts />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/forecast" element={<Forecast />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

export default App;
