import { useState, useEffect } from 'react';
import PageIntro from '../components/PageIntro';
import LoadingSpinner from '../components/LoadingSpinner';
import { getAttendance, getMeals } from '../services/api';

/**
 * Reports page with real data summaries
 */
function Reports() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attendanceData, setAttendanceData] = useState([]);
  const [mealsData, setMealsData] = useState([]);

  useEffect(() => {
    async function loadReportData() {
      try {
        setLoading(true);
        setError(null);

        const [attendanceResponse, mealsResponse] = await Promise.all([
          getAttendance(),
          getMeals(),
        ]);

        setAttendanceData(attendanceResponse.attendance || []);
        setMealsData(mealsResponse.meals || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadReportData();
  }, []);

  // Calculate totals
  const totalAttendanceRegistered = attendanceData.reduce((sum, record) => sum + record.total_registered, 0);
  const totalAttendancePresent = attendanceData.reduce((sum, record) => sum + record.total_present, 0);
  const totalAttendanceAbsent = attendanceData.reduce((sum, record) => sum + record.total_absent, 0);
  const totalMealsPrepared = mealsData.reduce((sum, record) => sum + record.meals_prepared, 0);
  const totalMealsServed = mealsData.reduce((sum, record) => sum + record.meals_served, 0);

  if (loading) {
    return (
      <PageIntro
        title="Reports"
        purpose="View attendance and meal distribution summaries"
      >
        <LoadingSpinner message="Loading report data..." />
      </PageIntro>
    );
  }

  if (error) {
    return (
      <PageIntro
        title="Reports"
        purpose="View attendance and meal distribution summaries"
      >
        <div className="error-state">
          <h3>Unable to load reports</h3>
          <p>{error}</p>
        </div>
      </PageIntro>
    );
  }

  return (
    <PageIntro
      title="Reports"
      purpose="Attendance and meal distribution summaries for programme officers"
    >
      <section className="form-section">
        <h2>Overall Totals</h2>
        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-card__label">Total Registered (All Time)</p>
            <p className="stat-card__value stat-card__value--small">{totalAttendanceRegistered}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Total Present (All Time)</p>
            <p className="stat-card__value stat-card__value--small">{totalAttendancePresent}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Total Absent (All Time)</p>
            <p className="stat-card__value stat-card__value--small">{totalAttendanceAbsent}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Total Meals Served (All Time)</p>
            <p className="stat-card__value stat-card__value--small">{totalMealsServed}</p>
          </div>
        </div>
      </section>

      <section className="history-section">
        <h2>Attendance by Date</h2>
        {attendanceData.length === 0 ? (
          <div className="empty-state">
            <p>No attendance data available</p>
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
                {attendanceData.map((record) => (
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
      </section>

      <section className="history-section">
        <h2>Meal Distribution by Date</h2>
        {mealsData.length === 0 ? (
          <div className="empty-state">
            <p>No meal distribution data available</p>
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
                {mealsData.map((record) => (
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
      </section>
    </PageIntro>
  );
}

export default Reports;
