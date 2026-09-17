import { useState, useEffect } from 'react';
import PageIntro from '../components/PageIntro';
import LoadingSpinner from '../components/LoadingSpinner';
import { getAttendance, getMeals, getSchools } from '../services/api';
import { cacheSchools, getCachedSchools, getLocalAttendance, getLocalMeals } from '../services/localDb';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

/**
 * Dashboard page with real API data
 */
function Dashboard() {
  const isOnline = useOnlineStatus();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [schools, setSchools] = useState([]);
  const [todayData, setTodayData] = useState({
    attendance: null,
    meals: null,
  });
  const [recentAttendance, setRecentAttendance] = useState([]);
  const [recentMeals, setRecentMeals] = useState([]);

  // Helper function to format date as DD-MM-YYYY for display
  function formatDateForDisplay(dateString) {
    if (!dateString) return '';
    // If already in DD-MM-YYYY format, return as is
    const dateRegex = /^\d{2}-\d{2}-\d{4}$/;
    if (dateRegex.test(dateString)) {
      return dateString;
    }
    // Otherwise convert from ISO format
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  }

  const today = formatDateForDisplay(new Date());

  // Helper function to get school name from ID
  function getSchoolName(schoolId) {
    const school = schools.find(s => s.id === schoolId || s.id === parseInt(schoolId));
    return school ? school.name : 'Unknown School';
  }

  // Helper function to normalize record data for display
  function normalizeAttendanceRecord(record) {
    return {
      ...record,
      attendance_date: record.attendance_date || record.attendanceDate,
      school_name: record.school_name || getSchoolName(record.schoolId || record.school_id),
      total_registered: record.total_registered || record.totalRegistered,
      total_present: record.total_present || record.totalPresent,
      total_absent: record.total_absent || record.totalAbsent,
    };
  }

  function normalizeMealRecord(record) {
    return {
      ...record,
      distribution_date: record.distribution_date || record.distributionDate,
      school_name: record.school_name || getSchoolName(record.schoolId || record.school_id),
      meals_prepared: record.meals_prepared || record.mealsPrepared,
      meals_served: record.meals_served || record.mealsServed,
    };
  }

  useEffect(() => {
    async function loadDashboardData() {
      try {
        setLoading(true);
        setError(null);

        // Load schools for offline use
        let schoolsData = [];
        try {
          const schoolsResponse = await getSchools();
          schoolsData = schoolsResponse.schools || [];
          await cacheSchools(schoolsData);
        } catch (err) {
          console.warn('Could not fetch schools:', err.message);
          try {
            schoolsData = await getCachedSchools();
          } catch (cacheErr) {
            console.warn('Could not get cached schools:', cacheErr.message);
            schoolsData = []; // Empty array is better than crashing
          }
        }
        setSchools(schoolsData);

        // Try to fetch from server, fall back to local data
        let todayAttendance = null;
        let todayMeals = null;
        let recentAttendanceData = [];
        let recentMealsData = [];

        try {
          // Fetch today's attendance (backend now accepts DD-MM-YYYY)
          const attendanceResponse = await getAttendance({ date: today });
          todayAttendance = attendanceResponse.attendance?.[0] || null;

          // Fetch today's meals (backend now accepts DD-MM-YYYY)
          const mealsResponse = await getMeals({ date: today });
          todayMeals = mealsResponse.meals?.[0] || null;

          // Fetch recent attendance (last 5 records)
          const recentAttendanceResponse = await getAttendance();
          recentAttendanceData = recentAttendanceResponse.attendance?.slice(0, 5) || [];

          // Fetch recent meals (last 5 records)
          const recentMealsResponse = await getMeals();
          recentMealsData = recentMealsResponse.meals?.slice(0, 5) || [];
        } catch (serverError) {
          console.warn('Server unavailable, using local data:', serverError.message);
          
          // Fall back to local data
          try {
            const localAttendance = await getLocalAttendance();
            const localMeals = await getLocalMeals();
            
            // Find today's records
            todayAttendance = localAttendance.find(r => r.attendanceDate === today) || null;
            todayMeals = localMeals.find(r => r.distributionDate === today) || null;
            
            // Get recent records
            recentAttendanceData = localAttendance.slice(0, 5);
            recentMealsData = localMeals.slice(0, 5);
          } catch (localError) {
            console.warn('Could not get local data:', localError.message);
            // Continue with empty data
          }
        }

        setTodayData({ attendance: todayAttendance, meals: todayMeals });
        setRecentAttendance(recentAttendanceData);
        setRecentMeals(recentMealsData);

      } catch (err) {
        // Only set error if it's not a network error (which is expected offline)
        if (!err.message.includes('Network error') && !err.message.includes('fetch')) {
          setError(err.message);
        }
        // For network errors, just continue with local data
        console.warn('Network error, using local data:', err.message);
      } finally {
        setLoading(false);
      }
    }

    loadDashboardData();
  }, [today]);

  if (loading) {
    return (
      <PageIntro
        title="Dashboard"
        purpose="Overview of school feeding activity"
      >
        <LoadingSpinner message="Loading dashboard data..." />
      </PageIntro>
    );
  }

  if (error) {
    return (
      <PageIntro
        title="Dashboard"
        purpose="Overview of school feeding activity"
      >
        <div className="error-state">
          <h3>Unable to load dashboard</h3>
          <p>{error}</p>
        </div>
      </PageIntro>
    );
  }

  const totalRegistered = todayData.attendance?.total_registered || todayData.attendance?.totalRegistered || 0;
  const totalPresent = todayData.attendance?.total_present || todayData.attendance?.totalPresent || 0;
  const totalAbsent = todayData.attendance?.total_absent || todayData.attendance?.totalAbsent || 0;
  const mealsPrepared = todayData.meals?.meals_prepared || todayData.meals?.mealsPrepared || 0;
  const mealsServed = todayData.meals?.meals_served || todayData.meals?.mealsServed || 0;

  return (
    <PageIntro
      title="Dashboard"
      purpose="Overview of school feeding activity for today"
    >
      {!isOnline && (
        <div className="form-warning" style={{ marginBottom: '1rem' }}>
          <strong>Offline Mode:</strong> Showing local data only. Changes will be saved locally and synced when you go online.
        </div>
      )}
      
      <div className="stats-grid">
        <div className="stat-card">
          <p className="stat-card__label">Total Registered</p>
          <p className="stat-card__value">{totalRegistered}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__label">Present Today</p>
          <p className="stat-card__value">{totalPresent}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__label">Absent Today</p>
          <p className="stat-card__value">{totalAbsent}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__label">Meals Served</p>
          <p className="stat-card__value">{mealsServed}</p>
        </div>
      </div>

      {!todayData.attendance && !todayData.meals && (
        <div className="empty-state">
          <h3>No data for today</h3>
          <p>Record attendance and meal distribution to see today's statistics here.</p>
        </div>
      )}

      <div className="history-section">
        <h2>Recent Attendance Records</h2>
        {recentAttendance.length === 0 ? (
          <div className="empty-state">
            <p>No attendance records yet</p>
          </div>
        ) : (
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>School</th>
                  <th>Registered</th>
                  <th>Present</th>
                  <th>Absent</th>
                </tr>
              </thead>
              <tbody>
                {recentAttendance.map((record) => {
                  const normalized = normalizeAttendanceRecord(record);
                  return (
                    <tr key={record.id}>
                      <td>{formatDateForDisplay(normalized.attendance_date)}</td>
                      <td>{normalized.school_name}</td>
                      <td>{normalized.total_registered}</td>
                      <td>{normalized.total_present}</td>
                      <td>{normalized.total_absent}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="history-section">
        <h2>Recent Meal Distribution Records</h2>
        {recentMeals.length === 0 ? (
          <div className="empty-state">
            <p>No meal distribution records yet</p>
          </div>
        ) : (
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>School</th>
                  <th>Prepared</th>
                  <th>Served</th>
                </tr>
              </thead>
              <tbody>
                {recentMeals.map((record) => {
                  const normalized = normalizeMealRecord(record);
                  return (
                    <tr key={record.id}>
                      <td>{formatDateForDisplay(normalized.distribution_date)}</td>
                      <td>{normalized.school_name}</td>
                      <td>{normalized.meals_prepared}</td>
                      <td>{normalized.meals_served}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageIntro>
  );
}

export default Dashboard;
