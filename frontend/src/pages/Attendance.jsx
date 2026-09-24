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
import { manualSync } from '../sync/syncManager';

/**
 * Attendance page with form and history
 */
function Attendance() {
  const isOnline = useOnlineStatus();
  
  // Helper function to format date as DD-MM-YYYY for input
  function formatDateForInput(date) {
    // If already in DD-MM-YYYY format, return as is
    if (typeof date === 'string' && /^\d{2}-\d{2}-\d{4}$/.test(date)) {
      return date;
    }
    
    // If it's a Date object, format it
    if (date instanceof Date) {
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}-${month}-${year}`;
    }
    
    // If it's an ISO string or other format, convert to Date then format
    try {
      const dateObj = new Date(date);
      const day = String(dateObj.getDate()).padStart(2, '0');
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const year = dateObj.getFullYear();
      return `${day}-${month}-${year}`;
    } catch (e) {
      console.error('Invalid date format:', date);
      return formatDateForInput(new Date()); // Return today's date as fallback
    }
  }

  const [schools, setSchools] = useState([]);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [formError, setFormError] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);

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
        
        // Combine local and server records, but deduplicate by serverId
        // Local records take precedence over server records
        const serverIds = new Set(localAttendance.map(r => r.serverId).filter(Boolean));
        const uniqueServerAttendance = serverAttendance.filter(r => !serverIds.has(r.id));
        
        setAttendanceRecords([...localAttendance, ...uniqueServerAttendance]);
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

      if (editingRecord) {
        // Check if the record exists in local database by either local ID or server ID
        let localRecord = await getLocalAttendanceById(editingRecord.id);
        
        // If not found by local ID, try to find by server ID
        if (!localRecord && editingRecord.serverId) {
          const allLocalRecords = await getLocalAttendance();
          localRecord = allLocalRecords.find(r => r.serverId === editingRecord.serverId);
        }
        
        if (!localRecord) {
          // Record is from server only, create it locally first
          // Don't preserve the server ID to avoid key conflicts
          localRecord = await saveLocalAttendance({
            ...attendanceData,
            serverId: editingRecord.id // Store server ID separately
          });
          setSuccessMessage('Attendance record created locally from server data');
        } else {
          // Update existing local record - maintains the same local ID
          await updateLocalAttendance(localRecord.id, attendanceData);
          setSuccessMessage(isOnline 
            ? 'Attendance record updated and queued for synchronization' 
            : 'Attendance record updated locally (pending synchronization when online)');
        }
        
        setEditingRecord(null);
      } else {
        // Create new record
        await saveLocalAttendance(attendanceData);
        setSuccessMessage(isOnline 
          ? 'Attendance record created and queued for synchronization' 
          : 'Attendance record saved locally (pending synchronization when online)');
      }
      
      // Auto-sync if online after a short delay
      if (isOnline) {
        setTimeout(async () => {
          try {
            await manualSync();
            console.log('Auto-sync completed after record update');
          } catch (error) {
            console.error('Auto-sync failed after record update:', error);
          }
        }, 2000); // 2 second delay to allow operation to queue
      }
      
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

  const handleEditRecord = (record) => {
    setEditingRecord(record);
    
    // Handle date format - if already in DD-MM-YYYY format, use as is
    let attendanceDate = record.attendanceDate || record.attendance_date;
    if (attendanceDate && !attendanceDate.includes('-')) {
      // If it's a Date object or ISO string, format it
      attendanceDate = formatDateForInput(new Date(attendanceDate));
    }
    // If it's already in DD-MM-YYYY format, use it directly
    
    setFormData({
      school_id: record.schoolId || record.school_id || '',
      attendance_date: attendanceDate || formatDateForInput(new Date()),
      total_registered: record.totalRegistered || record.total_registered || '',
      total_present: record.totalPresent || record.total_present || '',
      total_absent: record.totalAbsent || record.total_absent || '',
    });
    setSuccessMessage(null);
    setFormError(null);
    
    // Smooth scroll to form section
    const formSection = document.querySelector('.form-section');
    if (formSection) {
      formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleCancelEdit = () => {
    setEditingRecord(null);
    setFormData({
      school_id: '',
      attendance_date: formatDateForInput(new Date()),
      total_registered: '',
      total_present: '',
      total_absent: '',
    });
    setFormError(null);
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
      
      <section className="form-section" style={{
        border: editingRecord ? '2px solid var(--color-primary)' : 'none',
        borderRadius: editingRecord ? '4px' : '0',
        padding: editingRecord ? '1rem' : '0',
        backgroundColor: editingRecord ? 'var(--color-info-bg)' : 'transparent',
        transition: 'all 0.3s ease'
      }}>
        <h2>{editingRecord ? 'Edit Attendance' : 'Record Attendance'}</h2>
        {editingRecord && (
          <p style={{ fontSize: '0.9rem', color: 'var(--color-muted)', marginBottom: '1rem' }}>
            Editing record from {formatDateForDisplay(editingRecord.attendanceDate || editingRecord.attendance_date)}
          </p>
        )}
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
              {submitting ? 'Submitting...' : (editingRecord ? 'Update Attendance' : 'Submit Attendance')}
            </button>
            {editingRecord && (
              <button 
                type="button" 
                className="btn btn--secondary" 
                onClick={handleCancelEdit}
                disabled={submitting}
              >
                Cancel
              </button>
            )}
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
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {attendanceRecords.map((record) => (
                  <tr key={`${record.id}-${record.syncStatus || 'server'}`}>
                    <td>{formatDateForDisplay(record.attendance_date || record.attendanceDate)}</td>
                    <td>{record.school_name || getSchoolName(record.schoolId || record.school_id)}</td>
                    <td>{record.total_registered || record.totalRegistered}</td>
                    <td>{record.total_present || record.totalPresent}</td>
                    <td>{record.total_absent || record.totalAbsent}</td>
                    <td>{getSyncStatusDisplay(record)}</td>
                    <td>{formatDateForDisplay(record.updated_at || record.updatedAt)}</td>
                    <td>
                      <button
                        className="btn btn--small"
                        onClick={() => handleEditRecord(record)}
                        disabled={submitting}
                      >
                        Edit
                      </button>
                    </td>
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
