import { useState, useEffect } from 'react';
import PageIntro from '../components/PageIntro';
import LoadingSpinner from '../components/LoadingSpinner';
import { getSchools, getAttendance, createAttendance } from '../services/api';
import { 
  getLocalAttendance, 
  saveLocalAttendance, 
  getLocalAttendanceById,
  updateLocalAttendance,
  cacheSchools,
  getCachedSchools
} from '../services/localDb';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

/**
 * Attendance page with form and history
 */
function Attendance() {
  const isOnline = useOnlineStatus();
  
  // Helper function to format date as DD-MM-YYYY for input
  function formatDateForInput(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  }

  const [schools, setSchools] = useState([]);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [formError, setFormError] = useState(null);

  const [formData, setFormData] = useState({
    school_id: '',
    attendance_date: formatDateForInput(new Date()),
    total_registered: '',
    total_present: '',
    total_absent: '',
  });

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

  // Helper function to get school name from ID
  function getSchoolName(schoolId) {
    const school = schools.find(s => s.id === schoolId || s.id === parseInt(schoolId));
    return school ? school.name : 'Unknown School';
  }

  // Helper function to get sync status display
  function getSyncStatusDisplay(record) {
    if (record.syncStatus) {
      return record.syncStatus === 'synced' ? 'Synced' : 'Pending';
    }
    return 'Synced'; // Server records are considered synced
  }

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        // Try to get schools from server first, fall back to cache
        let schoolsData = [];
        try {
          const schoolsResponse = await getSchools();
          schoolsData = schoolsResponse.schools || [];
          // Cache schools for offline use
          await cacheSchools(schoolsData);
        } catch (serverError) {
          console.warn('Server unavailable, using cached schools:', serverError.message);
          // Fall back to cached schools
          try {
            schoolsData = await getCachedSchools();
          } catch (cacheError) {
            console.warn('Could not get cached schools:', cacheError.message);
            schoolsData = []; // Don't crash, just show empty list
          }
        }

        setSchools(schoolsData);

        const [localAttendanceResult, serverAttendanceResult] = await Promise.allSettled([
          getLocalAttendance(),
          getAttendance().catch(() => ({ attendance: [] }))
        ]);
        
        const localAttendance = localAttendanceResult.status === 'fulfilled' ? localAttendanceResult.value : [];
        const serverAttendance = serverAttendanceResult.status === 'fulfilled' ? serverAttendanceResult.value.attendance : [];
        
        // Combine local and server records
        setAttendanceRecords([...localAttendance, ...serverAttendance]);
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

    loadData();
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setFormError(null);
  };

  const validateForm = () => {
    if (!formData.school_id) {
      setFormError('Please select a school');
      return false;
    }
    if (!formData.attendance_date) {
      setFormError('Please enter a date');
      return false;
    }
    
    // Validate DD-MM-YYYY format
    const dateRegex = /^\d{2}-\d{2}-\d{4}$/;
    if (!dateRegex.test(formData.attendance_date)) {
      setFormError('Date must be in DD-MM-YYYY format (e.g., 15-09-2026)');
      return false;
    }
    
    // Validate that the date is valid
    const parts = formData.attendance_date.split('-');
    const day = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    const year = parseInt(parts[2]);
    
    if (month < 1 || month > 12) {
      setFormError('Invalid month');
      return false;
    }
    if (day < 1 || day > 31) {
      setFormError('Invalid day');
      return false;
    }
    if (year < 1900 || year > 2100) {
      setFormError('Invalid year');
      return false;
    }
    
    if (!formData.total_registered || formData.total_registered < 0) {
      setFormError('Total registered must be a non-negative number');
      return false;
    }
    if (!formData.total_present || formData.total_present < 0) {
      setFormError('Total present must be a non-negative number');
      return false;
    }
    if (!formData.total_absent || formData.total_absent < 0) {
      setFormError('Total absent must be a non-negative number');
      return false;
    }
    
    const registered = parseInt(formData.total_registered);
    const present = parseInt(formData.total_present);
    const absent = parseInt(formData.total_absent);
    
    if (present + absent > registered) {
      setFormError('Total present + absent cannot exceed total registered');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    if (!validateForm()) {
      return;
    }

    try {
      setSubmitting(true);
      
      const attendanceData = {
        schoolId: formData.school_id,
        attendanceDate: formData.attendance_date,
        totalRegistered: parseInt(formData.total_registered),
        totalPresent: parseInt(formData.total_present),
        totalAbsent: parseInt(formData.total_absent),
      };

      // Save to local database (this now queues the operation automatically)
      const localRecord = await saveLocalAttendance(attendanceData);
      
      setSuccessMessage(isOnline 
        ? 'Attendance record created and queued for synchronization' 
        : 'Attendance record saved locally (pending synchronization when online)');
      
      // Reset form
      setFormData({
        school_id: '',
        attendance_date: formatDateForInput(new Date()),
        total_registered: '',
        total_present: '',
        total_absent: '',
      });

      // Reload attendance records from local database
      const localRecords = await getLocalAttendance();
      setAttendanceRecords(localRecords);

    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <PageIntro
        title="Attendance"
        purpose="Record and review learner attendance"
      >
        <LoadingSpinner message="Loading attendance data..." />
      </PageIntro>
    );
  }

  if (error) {
    return (
      <PageIntro
        title="Attendance"
        purpose="Record and review learner attendance"
      >
        <div className="error-state">
          <h3>Unable to load attendance data</h3>
          <p>{error}</p>
        </div>
      </PageIntro>
    );
  }

  return (
    <PageIntro
      title="Attendance"
      purpose="Record and review learner attendance for school feeding days"
    >
      {!isOnline && (
        <div className="form-warning" style={{ marginBottom: '1rem' }}>
          <strong>Offline Mode:</strong> Records will be saved locally and synced when you go online.
        </div>
      )}
      
      <section className="form-section">
        <h2>Record Attendance</h2>
        {formError && <div className="form-error">{formError}</div>}
        {successMessage && <div className="form-success">{successMessage}</div>}
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="school_id">School *</label>
            <select
              id="school_id"
              name="school_id"
              value={formData.school_id}
              onChange={handleInputChange}
              required
              disabled={submitting}
            >
              <option value="">Select a school</option>
              {schools.map(school => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="attendance_date">Date (DD-MM-YYYY) *</label>
            <input
              id="attendance_date"
              name="attendance_date"
              type="text"
              placeholder="15-09-2026"
              value={formData.attendance_date}
              onChange={handleInputChange}
              required
              disabled={submitting}
            />
          </div>

          <div className="form-row form-row--three">
            <div className="form-group">
              <label htmlFor="total_registered">Total Registered *</label>
              <input
                id="total_registered"
                name="total_registered"
                type="number"
                min="0"
                value={formData.total_registered}
                onChange={handleInputChange}
                required
                disabled={submitting}
              />
            </div>

            <div className="form-group">
              <label htmlFor="total_present">Total Present *</label>
              <input
                id="total_present"
                name="total_present"
                type="number"
                min="0"
                value={formData.total_present}
                onChange={handleInputChange}
                required
                disabled={submitting}
              />
            </div>

            <div className="form-group">
              <label htmlFor="total_absent">Total Absent *</label>
              <input
                id="total_absent"
                name="total_absent"
                type="number"
                min="0"
                value={formData.total_absent}
                onChange={handleInputChange}
                required
                disabled={submitting}
              />
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit Attendance'}
            </button>
          </div>
        </form>
      </section>

      <section className="history-section">
        <h2>Attendance History</h2>
        {attendanceRecords.length === 0 ? (
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
                  <th>Status</th>
                  <th>Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {attendanceRecords.map((record) => (
                  <tr key={record.id}>
                    <td>{formatDateForDisplay(record.attendance_date || record.attendanceDate)}</td>
                    <td>{record.school_name || getSchoolName(record.schoolId || record.school_id)}</td>
                    <td>{record.total_registered || record.totalRegistered}</td>
                    <td>{record.total_present || record.totalPresent}</td>
                    <td>{record.total_absent || record.totalAbsent}</td>
                    <td>{getSyncStatusDisplay(record)}</td>
                    <td>{formatDateForDisplay(record.updated_at || record.updatedAt)}</td>
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

export default Attendance;
