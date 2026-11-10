import { Navigate, Routes, Route } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import AppShell from './components/shell/AppShell';
import AuthLayout from './components/shell/AuthLayout';
import Dashboard from './pages/Dashboard';
import SyncStatus from './pages/SyncStatus';
import Conflicts from './pages/Conflicts';
import Review from './pages/Review';
import WeeklyReview from './pages/WeeklyReview';
import Analytics from './pages/Analytics';
import EnrolmentChecks from './pages/EnrolmentChecks';
import Today from './pages/Today';
import Stock from './pages/Stock';
import Enrolment from './pages/Enrolment';
import Term from './pages/Term';
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
        {/* School staff start on the day's feeding record */}
        <Route path="/" element={session.user?.role === 'school_staff' ? <Navigate to="/today" replace /> : <Dashboard />} />
        <Route path="/today" element={<Today />} />
        <Route path="/stock" element={<Stock />} />
        <Route path="/enrolment" element={<Enrolment />} />
        <Route path="/term" element={<Term />} />
        <Route path="/sync" element={<SyncStatus />} />
        <Route path="/conflicts" element={<Conflicts />} />
        <Route path="/review" element={<Review />} />
        <Route path="/weekly-review" element={<WeeklyReview />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/enrolment-checks" element={<EnrolmentChecks />} />
        {/* Reports showed the older attendance and meal records; Analytics replaces it */}
        <Route path="/reports" element={<Navigate to="/analytics" replace />} />
        {/* The older attendance and meal pages; the day's feeding record on Today replaces both */}
        <Route path="/attendance" element={<Navigate to="/today" replace />} />
        <Route path="/meals" element={<Navigate to="/today" replace />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

export default App;
