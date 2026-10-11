import { useState, useEffect } from 'react';
import PageIntro from '../components/PageIntro';
import LoadingSpinner from '../components/LoadingSpinner';
import { 
  getAttendance, 
  getMeals, 
  getAttendanceReport, 
  getMealsReport 
} from '../services/api';
import { 
  getLocalAttendance, 
  getLocalMeals,
  getLocalAttendanceByDateRange,
  getLocalMealsByDateRange
} from '../services/localDb';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

/**
 * Reports page with enhanced date range filtering and detailed tables
 */
function Reports() {
  const isOnline = useOnlineStatus();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dateRange, setDateRange] = useState('30days'); // today, 7days, 30days, custom
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [attendanceData, setAttendanceData] = useState([]);
  const [mealsData, setMealsData] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);

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

  // Calculate date ranges
  function getDateRangeForPeriod(period) {
    const now = new Date();
    const end = formatDateForDisplay(now);
    
    let start;
    if (period === 'today') {
      start = end;
    } else if (period === '7days') {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      start = formatDateForDisplay(sevenDaysAgo);
    } else if (period === '30days') {
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      start = formatDateForDisplay(thirtyDaysAgo);
    } else if (period === 'custom') {
      // Only use custom dates if both are set
      if (customStartDate && customEndDate) {
        start = customStartDate;
      } else {
        // Fall back to today if custom dates not set
        start = end;
      }
    }
    
    return { start, end };
  }

  // Handle custom date input format conversion
  const handleCustomDateChange = (field, value) => {
    if (!value) {
      if (field === 'start') {
        setCustomStartDate('');
      } else {
        setCustomEndDate('');
      }
      return;
    }
    
    if (field === 'start') {
      const parts = value.split('-');
      if (parts.length === 3) {
        setCustomStartDate(`${parts[2]}-${parts[1]}-${parts[0]}`);
      }
    } else {
      const parts = value.split('-');
      if (parts.length === 3) {
        setCustomEndDate(`${parts[2]}-${parts[1]}-${parts[0]}`);
      }
    }
  };

  // Convert DD-MM-YYYY to YYYY-MM-DD for date input
  const convertForDateInput = (dateString) => {
    if (!dateString) return '';
    const parts = dateString.split('-');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dateString;
  };

  useEffect(() => {
    async function loadReportData() {
      try {
        setLoading(true);
        setError(null);

        const { start, end } = getDateRangeForPeriod(dateRange);

        // Validate custom date range
        if (dateRange === 'custom' && (!start || !end)) {
          console.warn('Custom date range not fully specified, skipping API call');
          setAttendanceData([]);
          setMealsData([]);
          setLoading(false);
          return;
        }

        // Try to fetch from server, fall back to local data
        try {
          const [attendanceResponse, mealsResponse] = await Promise.all([
            getAttendanceReport({ startDate: start, endDate: end }),
            getMealsReport({ startDate: start, endDate: end }),
          ]);

          setAttendanceData(attendanceResponse.attendance || []);
          setMealsData(mealsResponse.meals || []);
        } catch (serverError) {
          console.warn('Server unavailable, using local data:', serverError.message);
          
          // Fall back to local data
          try {
            let localAttendance;
            let localMeals;
            
            if (dateRange === 'custom') {
              localAttendance = await getLocalAttendanceByDateRange(start, end);
              localMeals = await getLocalMealsByDateRange(start, end);
            } else {
              localAttendance = await getLocalAttendance();
              localMeals = await getLocalMeals();
            }
            
            // Calculate attendance rate and meal difference for local data
            const processedAttendance = localAttendance.map(record => ({
              ...record,
              attendance_date: record.attendanceDate || record.attendance_date,
              school_name: record.school_name || 'Unknown School',
              total_registered: record.totalRegistered || record.total_registered || 0,
              total_present: record.totalPresent || record.total_present || 0,
              total_absent: record.totalAbsent || record.total_absent || 0,
              attendance_rate: record.totalRegistered > 0 
                ? Math.round((record.totalPresent / record.totalRegistered) * 100)
                : 0
            }));
            
            const processedMeals = localMeals.map(record => ({
              ...record,
              distribution_date: record.distributionDate || record.distribution_date,
              school_name: record.school_name || 'Unknown School',
              meals_prepared: record.mealsPrepared || record.meals_prepared || 0,
              meals_served: record.mealsServed || record.meals_served || 0,
              difference: (record.mealsPrepared || record.meals_prepared || 0) - (record.mealsServed || record.meals_served || 0)
            }));
            
            setAttendanceData(processedAttendance);
            setMealsData(processedMeals);
          } catch (localError) {
            console.warn('Could not get local data:', localError.message);
            setAttendanceData([]);
            setMealsData([]);
          }
        }

        setLastUpdated(new Date().toLocaleTimeString());
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadReportData();
  }, [dateRange, customStartDate, customEndDate, isOnline]);

  // Calculate totals
  const totalAttendanceRegistered = attendanceData.reduce((sum, record) => sum + (record.total_registered || 0), 0);
  const totalAttendancePresent = attendanceData.reduce((sum, record) => sum + (record.total_present || 0), 0);
  const totalAttendanceAbsent = attendanceData.reduce((sum, record) => sum + (record.total_absent || 0), 0);
  const totalMealsPrepared = mealsData.reduce((sum, record) => sum + (record.meals_prepared || 0), 0);
  const totalMealsServed = mealsData.reduce((sum, record) => sum + (record.meals_served || 0), 0);
  
  // Calculate overall attendance rate
  const overallAttendanceRate = totalAttendanceRegistered > 0 
    ? Math.round((totalAttendancePresent / totalAttendanceRegistered) * 100)
    : 0;
  
  const overallMealsDifference = totalMealsPrepared - totalMealsServed;

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
      {!isOnline && (
        <div className="form-warning" style={{ marginBottom: '1rem' }}>
          <strong>Offline Mode:</strong> Showing locally available data. Some information may not reflect the latest server state.
        </div>
      )}

      {/* Date Range Filter */}
      <section className="form-section">
        <h2>Date Range</h2>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select 
            value={dateRange} 
            onChange={(e) => setDateRange(e.target.value)}
            style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
          >
            <option value="today">Today</option>
            <option value="7days">Last 7 Days</option>
            <option value="30days">Last 30 Days</option>
            <option value="custom">Custom Range</option>
          </select>
          
          {dateRange === 'custom' && (
            <>
              <input
                type="date"
                value={convertForDateInput(customStartDate)}
                onChange={(e) => handleCustomDateChange('start', e.target.value)}
                style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
              />
              <span>to</span>
              <input
                type="date"
                value={convertForDateInput(customEndDate)}
                onChange={(e) => handleCustomDateChange('end', e.target.value)}
                style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
              />
            </>
          )}
          
          {lastUpdated && (
            <span style={{ fontSize: '0.85rem', color: 'var(--color-muted)', marginLeft: 'auto' }}>
              Last updated: {lastUpdated}
            </span>
          )}
        </div>
      </section>

      <section className="form-section">
        <h2>Overall Totals</h2>
        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-card__label">Total Registered</p>
            <p className="stat-card__value stat-card__value--small">{totalAttendanceRegistered}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Total Present</p>
            <p className="stat-card__value stat-card__value--small">{totalAttendancePresent}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Total Absent</p>
            <p className="stat-card__value stat-card__value--small">{totalAttendanceAbsent}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Attendance Rate</p>
            <p className="stat-card__value stat-card__value--small">{overallAttendanceRate}%</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Total Meals Prepared</p>
            <p className="stat-card__value stat-card__value--small">{totalMealsPrepared}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Total Meals Served</p>
            <p className="stat-card__value stat-card__value--small">{totalMealsServed}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Prepared vs Served</p>
            <p className="stat-card__value stat-card__value--small">{overallMealsDifference}</p>
          </div>
        </div>
      </section>

      <section className="history-section">
        <h2>Attendance by Date</h2>
        {attendanceData.length === 0 ? (
          <div className="empty-state">
            <p>No attendance data available for selected period</p>
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
                  <th>Attendance Rate</th>
                </tr>
              </thead>
              <tbody>
                {attendanceData.map((record) => (
                  <tr key={record.id}>
                    <td>{formatDateForDisplay(record.attendance_date)}</td>
                    <td>{record.school_name}</td>
                    <td>{record.total_registered}</td>
                    <td>{record.total_present}</td>
                    <td>{record.total_absent}</td>
                    <td>{record.attendance_rate || 0}%</td>
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
            <p>No meal distribution data available for selected period</p>
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
                  <th>Difference</th>
                </tr>
              </thead>
              <tbody>
                {mealsData.map((record) => (
                  <tr key={record.id}>
                    <td>{formatDateForDisplay(record.distribution_date)}</td>
                    <td>{record.school_name}</td>
                    <td>{record.meals_prepared}</td>
                    <td>{record.meals_served}</td>
                    <td>{record.difference || 0}</td>
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
