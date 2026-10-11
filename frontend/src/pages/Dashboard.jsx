import { useState, useEffect } from 'react';
import PageIntro from '../components/PageIntro';
import LoadingSpinner from '../components/LoadingSpinner';
import { 
  getAttendance, 
  getMeals, 
  getSchools, 
  getDashboardSummary,
  getAttendanceTrend,
  getMealsTrend
} from '../services/api';
import { 
  cacheSchools, 
  getCachedSchools, 
  getLocalAttendance, 
  getLocalMeals,
  getLocalSyncStats
} from '../services/localDb';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { getConflictStats } from '../sync/conflictService';
import { getSyncQueueStats } from '../sync/syncQueue';

/**
 * Dashboard page with enhanced reporting and date range filtering
 */
function Dashboard() {
  const isOnline = useOnlineStatus();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [schools, setSchools] = useState([]);
  const [dateRange, setDateRange] = useState('today'); // today, 7days, 30days, custom
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [dashboardSummary, setDashboardSummary] = useState(null);
  const [attendanceTrend, setAttendanceTrend] = useState([]);
  const [mealsTrend, setMealsTrend] = useState([]);
  const [recentAttendance, setRecentAttendance] = useState([]);
  const [recentMeals, setRecentMeals] = useState([]);
  const [syncStats, setSyncStats] = useState(null);
  const [conflictStats, setConflictStats] = useState(null);
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

  const today = formatDateForDisplay(new Date());

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

  // Handle custom date input format conversion
  const handleCustomDateChange = (field, value) => {
    if (!value) return;
    
    if (field === 'start') {
      // Convert from YYYY-MM-DD to DD-MM-YYYY
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
            schoolsData = [];
          }
        }
        setSchools(schoolsData);

        // Calculate date range based on selected period
        const { start, end } = getDateRangeForPeriod(dateRange);

        // Validate custom date range
        if (dateRange === 'custom' && (!start || !end)) {
          console.warn('Custom date range not fully specified, skipping API call');
          setDashboardSummary(null);
          setAttendanceTrend([]);
          setMealsTrend([]);
          setLoading(false);
          return;
        }

        // Load sync and conflict stats
        try {
          const [syncData, conflictData] = await Promise.all([
            isOnline ? getSyncQueueStats() : getLocalSyncStats(),
            getConflictStats()
          ]);
          setSyncStats(syncData);
          setConflictStats(conflictData);
        } catch (statsError) {
          console.warn('Could not load sync/conflict stats:', statsError.message);
        }

        // Try to fetch from server, fall back to local data
        try {
          // Fetch dashboard summary
          const summaryResponse = await getDashboardSummary({ 
            startDate: start, 
            endDate: end 
          });
          setDashboardSummary(summaryResponse.summary);

          // Fetch trend data
          const [attendanceTrendData, mealsTrendData] = await Promise.all([
            getAttendanceTrend({ startDate: start, endDate: end }),
            getMealsTrend({ startDate: start, endDate: end })
          ]);
          setAttendanceTrend(attendanceTrendData.trend || []);
          setMealsTrend(mealsTrendData.trend || []);

          // Fetch recent records for activity section
          const [recentAttendanceResponse, recentMealsResponse] = await Promise.all([
            getAttendance(),
            getMeals()
          ]);
          setRecentAttendance(recentAttendanceResponse.attendance?.slice(0, 5) || []);
          setRecentMeals(recentMealsResponse.meals?.slice(0, 5) || []);

        } catch (serverError) {
          console.warn('Server unavailable, using local data:', serverError.message);
          
          // Fall back to local data
          try {
            const localAttendance = await getLocalAttendance();
            const localMeals = await getLocalMeals();
            
            // Calculate local summary
            const localSummary = {
              attendance: {
                total_registered: localAttendance.reduce((sum, r) => sum + (r.totalRegistered || 0), 0),
                total_present: localAttendance.reduce((sum, r) => sum + (r.totalPresent || 0), 0),
                total_absent: localAttendance.reduce((sum, r) => sum + (r.totalAbsent || 0), 0),
                attendance_rate: 0,
                record_count: localAttendance.length
              },
              meals: {
                total_prepared: localMeals.reduce((sum, r) => sum + (r.mealsPrepared || 0), 0),
                total_served: localMeals.reduce((sum, r) => sum + (r.mealsServed || 0), 0),
                difference: 0,
                record_count: localMeals.length
              },
              sync: {
                pending_operations: syncStats?.pending || 0,
                conflict_count: syncStats?.conflict || 0,
                unresolved_conflicts: conflictStats?.unresolved || 0
              }
            };
            
            // Calculate attendance rate
            if (localSummary.attendance.total_registered > 0) {
              localSummary.attendance.attendance_rate = Math.round(
                (localSummary.attendance.total_present / localSummary.attendance.total_registered) * 100
              );
            }
            
            // Calculate meals difference
            localSummary.meals.difference = localSummary.meals.total_prepared - localSummary.meals.total_served;
            
            setDashboardSummary(localSummary);
            setRecentAttendance(localAttendance.slice(0, 5));
            setRecentMeals(localMeals.slice(0, 5));
            
          } catch (localError) {
            console.warn('Could not get local data:', localError.message);
          }
        }

        setLastUpdated(new Date().toLocaleTimeString());

      } catch (err) {
        // Only set error if it's not a network error (which is expected offline)
        if (!err.message.includes('Network error') && !err.message.includes('fetch')) {
          setError(err.message);
        }
        console.warn('Error loading dashboard:', err.message);
      } finally {
        setLoading(false);
      }
    }

    loadDashboardData();
  }, [dateRange, customStartDate, customEndDate, isOnline]);

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

  const { start, end } = getDateRangeForPeriod(dateRange);

  return (
    <PageIntro
      title="Dashboard"
      purpose="Overview of school feeding activity"
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

      {/* Summary Cards */}
      {dashboardSummary ? (
        <div className="stats-grid">
          {/* Attendance Cards */}
          <div className="stat-card">
            <p className="stat-card__label">Total Registered</p>
            <p className="stat-card__value">{dashboardSummary.attendance.total_registered}</p>
            <p className="stat-card__sublabel">{dashboardSummary.attendance.record_count} records</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Total Present</p>
            <p className="stat-card__value">{dashboardSummary.attendance.total_present}</p>
            <p className="stat-card__sublabel">{dashboardSummary.attendance.attendance_rate}% attendance rate</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Total Absent</p>
            <p className="stat-card__value">{dashboardSummary.attendance.total_absent}</p>
          </div>
          
          {/* Meal Cards */}
          <div className="stat-card">
            <p className="stat-card__label">Meals Prepared</p>
            <p className="stat-card__value">{dashboardSummary.meals.total_prepared}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Meals Served</p>
            <p className="stat-card__value">{dashboardSummary.meals.total_served}</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Prepared vs Served</p>
            <p className="stat-card__value">{dashboardSummary.meals.difference}</p>
            <p className="stat-card__sublabel">difference</p>
          </div>
          
          {/* Sync Status Cards */}
          <div className="stat-card">
            <p className="stat-card__label">Pending Sync</p>
            <p className="stat-card__value">{dashboardSummary.sync.pending_operations}</p>
            <p className="stat-card__sublabel">operations</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label">Unresolved Conflicts</p>
            <p className="stat-card__value" style={{ 
              color: dashboardSummary.sync.unresolved_conflicts > 0 ? 'var(--color-error-text)' : 'inherit' 
            }}>
              {dashboardSummary.sync.unresolved_conflicts}
            </p>
            <p className="stat-card__sublabel">conflicts</p>
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <h3>No data available for selected period</h3>
          <p>Try selecting a different date range or record attendance and meal distribution data.</p>
        </div>
      )}

      {/* Trends Section */}
      {(attendanceTrend.length > 0 || mealsTrend.length > 0) && (
        <section className="history-section">
          <h2>Attendance Trend</h2>
          {attendanceTrend.length === 0 ? (
            <div className="empty-state">
              <p>No attendance trend data available for this period</p>
            </div>
          ) : (
            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Registered</th>
                    <th>Present</th>
                    <th>Absent</th>
                    <th>Attendance Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceTrend.map((record, index) => (
                    <tr key={index}>
                      <td>{record.date}</td>
                      <td>{record.total_registered}</td>
                      <td>{record.total_present}</td>
                      <td>{record.total_absent}</td>
                      <td>{record.attendance_rate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {(attendanceTrend.length > 0 || mealsTrend.length > 0) && (
        <section className="history-section">
          <h2>Meal Distribution Trend</h2>
          {mealsTrend.length === 0 ? (
            <div className="empty-state">
              <p>No meal distribution trend data available for this period</p>
            </div>
          ) : (
            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Prepared</th>
                    <th>Served</th>
                    <th>Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {mealsTrend.map((record, index) => (
                    <tr key={index}>
                      <td>{record.date}</td>
                      <td>{record.total_prepared}</td>
                      <td>{record.total_served}</td>
                      <td>{record.difference}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Recent Activity Section */}
      <section className="history-section">
        <h2>Recent Activity</h2>
        {recentAttendance.length === 0 && recentMeals.length === 0 ? (
          <div className="empty-state">
            <p>No recent activity</p>
          </div>
        ) : (
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>School</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {recentAttendance.map((record) => {
                  const normalized = normalizeAttendanceRecord(record);
                  return (
                    <tr key={`attendance-${record.id}`}>
                      <td>{formatDateForDisplay(normalized.attendance_date)}</td>
                      <td>Attendance</td>
                      <td>{normalized.school_name}</td>
                      <td>
                        {normalized.total_present} present, {normalized.total_absent} absent
                      </td>
                    </tr>
                  );
                })}
                {recentMeals.map((record) => {
                  const normalized = normalizeMealRecord(record);
                  return (
                    <tr key={`meal-${record.id}`}>
                      <td>{formatDateForDisplay(normalized.distribution_date)}</td>
                      <td>Meal Distribution</td>
                      <td>{normalized.school_name}</td>
                      <td>
                        {normalized.meals_prepared} prepared, {normalized.meals_served} served
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageIntro>
  );
}

export default Dashboard;
