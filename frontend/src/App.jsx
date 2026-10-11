import { Routes, Route } from 'react-router-dom';
import { useEffect } from 'react';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Attendance from './pages/Attendance';
import MealDistribution from './pages/MealDistribution';
import SyncStatus from './pages/SyncStatus';
import Conflicts from './pages/Conflicts';
import Reports from './pages/Reports';
import Forecast from './pages/Forecast';
import Login from './pages/Login';
import { useSession } from './hooks/useSession';
import Settings from './pages/Settings';
import { setupAutoSync } from './sync/syncManager';

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
        <Route element={<Layout />}>
          <Route path="*" element={<Login />} />
        </Route>
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/login" element={<Login />} />
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
