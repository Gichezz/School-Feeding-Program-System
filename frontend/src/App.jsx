import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Attendance from './pages/Attendance';
import MealDistribution from './pages/MealDistribution';
import SyncStatus from './pages/SyncStatus';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

/**
 * Root application routes.
 * Domain features remain placeholders until later phases.
 */
function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/meals" element={<MealDistribution />} />
        <Route path="/sync" element={<SyncStatus />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

export default App;
