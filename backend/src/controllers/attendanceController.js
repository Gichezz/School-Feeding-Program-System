const { pool } = require('../db/pool');
const { NotFoundError, ValidationError, DatabaseError } = require('../utils/errors');

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
      params.push(date);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY ar.attendance_date DESC, s.name';

    const result = await pool.query(query, params);
    
    res.json({
      attendance: result.rows,
      count: result.rows.length,
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

    res.json({ attendance: result.rows[0] });
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
    const { school_id, attendance_date, total_registered, total_present, total_absent, updated_by, client_id } = req.body;

    // Validate required fields
    if (!school_id || !attendance_date || total_registered === undefined || total_present === undefined || total_absent === undefined) {
      throw new ValidationError('Missing required fields: school_id, attendance_date, total_registered, total_present, total_absent');
    }

    // Validate school_id format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(school_id)) {
      throw new ValidationError('Invalid school ID format');
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(attendance_date)) {
      throw new ValidationError('Invalid date format. Use YYYY-MM-DD');
    }

    // Validate non-negative values
    if (total_registered < 0 || total_present < 0 || total_absent < 0) {
      throw new ValidationError('Total registered, present, and absent must be non-negative');
    }

    // Validate that present + absent <= registered
    if (total_present + total_absent > total_registered) {
      throw new ValidationError('Total present + total absent cannot exceed total registered');
    }

    // Validate updated_by format if provided
    if (updated_by && !uuidRegex.test(updated_by)) {
      throw new ValidationError('Invalid user ID format');
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
      attendance_date,
      total_registered,
      total_present,
      total_absent,
      updated_by || null,
      client_id || null,
    ];

    const result = await pool.query(query, values);

    res.status(201).json({
      attendance: result.rows[0],
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
