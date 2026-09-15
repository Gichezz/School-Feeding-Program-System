import { useState, useEffect } from 'react';
import PageIntro from '../components/PageIntro';
import LoadingSpinner from '../components/LoadingSpinner';
import { getSchools, getAttendance, createAttendance } from '../services/api';

/**
 * Attendance page with form and history
 */
function Attendance() {
  const [schools, setSchools] = useState([]);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [formError, setFormError] = useState(null);

  const [formData, setFormData] = useState({
    school_id: '',
    attendance_date: new Date().toISOString().split('T')[0],
    total_registered: '',
    total_present: '',
    total_absent: '',
  });

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        const [schoolsResponse, attendanceResponse] = await Promise.all([
          getSchools(),
          getAttendance(),
        ]);

        setSchools(schoolsResponse.schools || []);
        setAttendanceRecords(attendanceResponse.attendance || []);
      } catch (err) {
        setError(err.message);
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
      setFormError('Please select a date');
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
        school_id: formData.school_id,
        attendance_date: formData.attendance_date,
        total_registered: parseInt(formData.total_registered),
        total_present: parseInt(formData.total_present),
        total_absent: parseInt(formData.total_absent),
      };

      await createAttendance(attendanceData);
      
      setSuccessMessage('Attendance record created successfully');
      
      // Reset form
      setFormData({
        school_id: '',
        attendance_date: new Date().toISOString().split('T')[0],
        total_registered: '',
        total_present: '',
        total_absent: '',
      });

      // Reload attendance records
      const attendanceResponse = await getAttendance();
      setAttendanceRecords(attendanceResponse.attendance || []);

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
            <label htmlFor="attendance_date">Date *</label>
            <input
              id="attendance_date"
              name="attendance_date"
              type="date"
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
                  <th>Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {attendanceRecords.map((record) => (
                  <tr key={record.id}>
                    <td>{record.attendance_date}</td>
                    <td>{record.school_name}</td>
                    <td>{record.total_registered}</td>
                    <td>{record.total_present}</td>
                    <td>{record.total_absent}</td>
                    <td>{new Date(record.updated_at).toLocaleDateString()}</td>
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
