const { pool } = require('../db/pool');
const { NotFoundError, ValidationError, DatabaseError } = require('../utils/errors');
const { attendanceError } = require('../validation/records');

/**
 * Helper function to convert DD-MM-YYYY to YYYY-MM-DD for PostgreSQL
 */
function convertDateFormat(dateString) {
  if (!dateString) return '';
  const parts = dateString.split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`; // Convert DD-MM-YYYY to YYYY-MM-DD
  }
  return dateString;
}

/**
 * Helper function to convert YYYY-MM-DD to DD-MM-YYYY for API responses
 */
function convertDateToDisplayFormat(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

/**
 * Get all attendance records with optional filtering by school and/or date
 */
async function getAttendance(req, res, next) {
  try {
    const { school_id, date } = req.query;
    
    let query = `
      SELECT 
        ar.id, ar.school_id, s.name as school_name,
        ar.attendance_date, ar.total_registered, ar.total_present, ar.total_absent,
        ar.version, ar.updated_at, ar.updated_by, ar.client_id
      FROM attendance_records ar
      JOIN schools s ON ar.school_id = s.id
    `;
    const params = [];
    const conditions = [];

    if (school_id) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(school_id)) {
        return res.status(400).json({ error: 'Invalid school ID format' });
      }
      conditions.push(`ar.school_id = $${params.length + 1}`);
      params.push(school_id);
    }

    if (date) {
      conditions.push(`ar.attendance_date = $${params.length + 1}`);
      params.push(convertDateFormat(date));
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY ar.attendance_date DESC, s.name';

    const result = await pool.query(query, params);
    
    // Convert dates to DD-MM-YYYY format for API response
    const formattedAttendance = result.rows.map(record => ({
      ...record,
      attendance_date: convertDateToDisplayFormat(record.attendance_date),
      updated_at: convertDateToDisplayFormat(record.updated_at),
    }));
    
    res.json({
      attendance: formattedAttendance,
      count: formattedAttendance.length,
    });
  } catch (error) {
    next(new DatabaseError('Failed to retrieve attendance records'));
  }
}

/**
 * Get a single attendance record by ID
 */
async function getAttendanceById(req, res, next) {
  try {
    const { id } = req.params;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: 'Invalid attendance ID format' });
    }

    const result = await pool.query(
      `SELECT 
        ar.id, ar.school_id, s.name as school_name,
        ar.attendance_date, ar.total_registered, ar.total_present, ar.total_absent,
        ar.version, ar.updated_at, ar.updated_by, ar.client_id
      FROM attendance_records ar
      JOIN schools s ON ar.school_id = s.id
      WHERE ar.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Attendance record not found');
    }

    // Convert dates to DD-MM-YYYY format for API response
    const formattedRecord = {
      ...result.rows[0],
      attendance_date: convertDateToDisplayFormat(result.rows[0].attendance_date),
      updated_at: convertDateToDisplayFormat(result.rows[0].updated_at),
    };

    res.json({ attendance: formattedRecord });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    next(error);
  }
}

/**
 * Create a new attendance record
 */
async function createAttendance(req, res, next) {
  try {
    const { school_id, attendance_date, total_registered, total_present, total_absent, client_id } = req.body;

    // Validate required fields
    if (!school_id || !attendance_date || total_registered === undefined || total_present === undefined || total_absent === undefined) {
      throw new ValidationError('Missing required fields: school_id, attendance_date, total_registered, total_present, total_absent');
    }

    // School id, real DD-MM-YYYY date, whole-number counts, present + absent = registered
    const invalid = attendanceError({
      schoolId: school_id,
      date: attendance_date,
      registered: total_registered,
      present: total_present,
      absent: total_absent,
    });
    if (invalid) {
      throw new ValidationError(invalid);
    }

    const query = `
      INSERT INTO attendance_records 
        (school_id, attendance_date, total_registered, total_present, total_absent, updated_by, client_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING 
        id, school_id, attendance_date, total_registered, total_present, total_absent,
        version, updated_at, updated_by, client_id
    `;

    const values = [
      school_id,
      convertDateFormat(attendance_date),
      total_registered,
      total_present,
      total_absent,
      req.user?.id || null, // updated_by: the signed-in user
      client_id || null,
    ];

    const result = await pool.query(query, values);

    // Convert dates to DD-MM-YYYY format for API response
    const formattedRecord = {
      ...result.rows[0],
      attendance_date: convertDateToDisplayFormat(result.rows[0].attendance_date),
      updated_at: convertDateToDisplayFormat(result.rows[0].updated_at),
    };

    res.status(201).json({
      attendance: formattedRecord,
      message: 'Attendance record created successfully',
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
}

module.exports = {
  getAttendance,
  getAttendanceById,
  createAttendance,
};
