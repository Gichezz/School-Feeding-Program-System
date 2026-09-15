import { useState, useEffect } from 'react';
import PageIntro from '../components/PageIntro';
import LoadingSpinner from '../components/LoadingSpinner';
import { getAttendance, getMeals } from '../services/api';

/**
 * Dashboard page with real API data
 */
function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [todayData, setTodayData] = useState({
    attendance: null,
    meals: null,
  });
  const [recentAttendance, setRecentAttendance] = useState([]);
  const [recentMeals, setRecentMeals] = useState([]);

  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    async function loadDashboardData() {
      try {
        setLoading(true);
        setError(null);

        // Fetch today's attendance
        const attendanceResponse = await getAttendance({ date: today });
        const todayAttendance = attendanceResponse.attendance?.[0] || null;
        setTodayData(prev => ({ ...prev, attendance: todayAttendance }));

        // Fetch today's meals
        const mealsResponse = await getMeals({ date: today });
        const todayMeals = mealsResponse.meals?.[0] || null;
        setTodayData(prev => ({ ...prev, meals: todayMeals }));

        // Fetch recent attendance (last 5 records)
        const recentAttendanceResponse = await getAttendance();
        setRecentAttendance(recentAttendanceResponse.attendance?.slice(0, 5) || []);

        // Fetch recent meals (last 5 records)
        const recentMealsResponse = await getMeals();
        setRecentMeals(recentMealsResponse.meals?.slice(0, 5) || []);

      } catch (err) {
        setError(err.message);
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

  const totalRegistered = todayData.attendance?.total_registered || 0;
  const totalPresent = todayData.attendance?.total_present || 0;
  const totalAbsent = todayData.attendance?.total_absent || 0;
  const mealsPrepared = todayData.meals?.meals_prepared || 0;
  const mealsServed = todayData.meals?.meals_served || 0;

  return (
    <PageIntro
      title="Dashboard"
      purpose="Overview of school feeding activity for today"
    >
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
                {recentAttendance.map((record) => (
                  <tr key={record.id}>
                    <td>{record.attendance_date}</td>
                    <td>{record.school_name}</td>
                    <td>{record.total_registered}</td>
                    <td>{record.total_present}</td>
                    <td>{record.total_absent}</td>
                  </tr>
                ))}
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
                {recentMeals.map((record) => (
                  <tr key={record.id}>
                    <td>{record.distribution_date}</td>
                    <td>{record.school_name}</td>
                    <td>{record.meals_prepared}</td>
                    <td>{record.meals_served}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageIntro>
  );
}

export default Dashboard;
