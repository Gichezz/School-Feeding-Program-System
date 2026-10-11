const { pool } = require('../db/pool');
const { ValidationError, DatabaseError } = require('../utils/errors');

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
 * Helper function to validate DD-MM-YYYY format
 */
function validateDateFormat(dateString) {
  if (!dateString) return false;
  const dateRegex = /^\d{2}-\d{2}-\d{4}$/;
  if (!dateRegex.test(dateString)) return false;
  
  const parts = dateString.split('-');
  const day = parseInt(parts[0]);
  const month = parseInt(parts[1]);
  const year = parseInt(parts[2]);
  
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (year < 1900 || year > 2100) return false;
  
  return true;
}

/**
 * Get dashboard summary with aggregated metrics
 */
async function getDashboardSummary(req, res, next) {
  try {
    const { startDate, endDate, school_id } = req.query;
    
    // Build separate WHERE clauses and params for attendance and meals
    const attendanceConditions = [];
    const mealsConditions = [];
    const attendanceParams = [];
    const mealsParams = [];
    let attendanceParamIndex = 1;
    let mealsParamIndex = 1;

    // Handle date range filtering
    if (startDate && endDate) {
      if (!validateDateFormat(startDate) || !validateDateFormat(endDate)) {
        throw new ValidationError('Invalid date format. Use DD-MM-YYYY (e.g., 15-09-2026)');
      }
      
      const startFormatted = convertDateFormat(startDate);
      const endFormatted = convertDateFormat(endDate);
      
      attendanceConditions.push(`attendance_date >= $${attendanceParamIndex}`);
      mealsConditions.push(`distribution_date >= $${mealsParamIndex}`);
      attendanceParams.push(startFormatted);
      mealsParams.push(startFormatted);
      attendanceParamIndex++;
      mealsParamIndex++;
      
      attendanceConditions.push(`attendance_date <= $${attendanceParamIndex}`);
      mealsConditions.push(`distribution_date <= $${mealsParamIndex}`);
      attendanceParams.push(endFormatted);
      mealsParams.push(endFormatted);
      attendanceParamIndex++;
      mealsParamIndex++;
    }

    // Handle school filtering
    if (school_id) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(school_id)) {
        throw new ValidationError('Invalid school ID format');
      }
      attendanceConditions.push(`school_id = $${attendanceParamIndex}`);
      mealsConditions.push(`school_id = $${mealsParamIndex}`);
      attendanceParams.push(school_id);
      mealsParams.push(school_id);
      attendanceParamIndex++;
      mealsParamIndex++;
    }

    const attendanceWhereClause = attendanceConditions.length > 0 
      ? ' WHERE ' + attendanceConditions.join(' AND ') 
      : '';
    
    const mealsWhereClause = mealsConditions.length > 0 
      ? ' WHERE ' + mealsConditions.join(' AND ') 
      : '';

    // Get attendance summary
    const attendanceQuery = `
      SELECT 
        COALESCE(SUM(total_registered), 0) as total_registered,
        COALESCE(SUM(total_present), 0) as total_present,
        COALESCE(SUM(total_absent), 0) as total_absent,
        COUNT(*) as record_count
      FROM attendance_records
      ${attendanceWhereClause}
    `;

    const attendanceResult = await pool.query(attendanceQuery, attendanceParams);
    const attendanceData = attendanceResult.rows[0];

    // Calculate attendance rate safely
    let attendanceRate = 0;
    if (attendanceData.total_registered > 0) {
      attendanceRate = Math.round((attendanceData.total_present / attendanceData.total_registered) * 100);
    }

    // Get meal distribution summary
    const mealsQuery = `
      SELECT 
        COALESCE(SUM(meals_prepared), 0) as total_prepared,
        COALESCE(SUM(meals_served), 0) as total_served,
        COUNT(*) as record_count
      FROM meal_distributions
      ${mealsWhereClause}
    `;

    const mealsResult = await pool.query(mealsQuery, mealsParams);
    const mealsData = mealsResult.rows[0];

    // Get sync status (pending operations and conflicts)
    const syncQuery = `
      SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
        COUNT(*) FILTER (WHERE status = 'conflict') as conflict_count
      FROM sync_operations
    `;

    const syncResult = await pool.query(syncQuery);
    const syncData = syncResult.rows[0];

    // Get conflict count
    const conflictQuery = `
      SELECT COUNT(*) as unresolved_count
      FROM conflicts
      WHERE status = 'unresolved'
    `;

    const conflictResult = await pool.query(conflictQuery);
    const conflictData = conflictResult.rows[0];

    res.json({
      success: true,
      summary: {
        attendance: {
          total_registered: parseInt(attendanceData.total_registered) || 0,
          total_present: parseInt(attendanceData.total_present) || 0,
          total_absent: parseInt(attendanceData.total_absent) || 0,
          attendance_rate: attendanceRate,
          record_count: parseInt(attendanceData.record_count) || 0
        },
        meals: {
          total_prepared: parseInt(mealsData.total_prepared) || 0,
          total_served: parseInt(mealsData.total_served) || 0,
          difference: parseInt(mealsData.total_prepared) - parseInt(mealsData.total_served) || 0,
          record_count: parseInt(mealsData.record_count) || 0
        },
        sync: {
          pending_operations: parseInt(syncData.pending_count) || 0,
          conflict_count: parseInt(syncData.conflict_count) || 0,
          unresolved_conflicts: parseInt(conflictData.unresolved_count) || 0
        }
      }
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message });
    }
    next(new DatabaseError('Failed to retrieve dashboard summary'));
  }
}

/**
 * Get attendance report with date range filtering
 */
async function getAttendanceReport(req, res, next) {
  try {
    const { startDate, endDate, school_id } = req.query;
    
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

    // Handle date range filtering
    if (startDate && endDate) {
      if (!validateDateFormat(startDate) || !validateDateFormat(endDate)) {
        throw new ValidationError('Invalid date format. Use DD-MM-YYYY (e.g., 15-09-2026)');
      }
      
      const startFormatted = convertDateFormat(startDate);
      const endFormatted = convertDateFormat(endDate);
      
      conditions.push(`ar.attendance_date >= $${params.length + 1}`);
      params.push(startFormatted);
      
      conditions.push(`ar.attendance_date <= $${params.length + 1}`);
      params.push(endFormatted);
    }

    // Handle school filtering
    if (school_id) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(school_id)) {
        throw new ValidationError('Invalid school ID format');
      }
      conditions.push(`ar.school_id = $${params.length + 1}`);
      params.push(school_id);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY ar.attendance_date DESC, s.name';

    const result = await pool.query(query, params);
    
    // Convert dates to DD-MM-YYYY format and calculate attendance rate
    const formattedAttendance = result.rows.map(record => {
      const totalRegistered = parseInt(record.total_registered) || 0;
      const totalPresent = parseInt(record.total_present) || 0;
      const totalAbsent = parseInt(record.total_absent) || 0;
      
      const attendanceRate = totalRegistered > 0 
        ? Math.round((totalPresent / totalRegistered) * 100)
        : 0;
      
      return {
        ...record,
        attendance_date: convertDateToDisplayFormat(record.attendance_date),
        updated_at: convertDateToDisplayFormat(record.updated_at),
        attendance_rate: attendanceRate
      };
    });
    
    res.json({
      success: true,
      attendance: formattedAttendance,
      count: formattedAttendance.length
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message });
    }
    next(new DatabaseError('Failed to retrieve attendance report'));
  }
}

/**
 * Get meal distribution report with date range filtering
 */
async function getMealsReport(req, res, next) {
  try {
    const { startDate, endDate, school_id } = req.query;
    
    let query = `
      SELECT 
        md.id, md.school_id, s.name as school_name,
        md.distribution_date, md.meals_prepared, md.meals_served,
        md.version, md.updated_at, md.updated_by, md.client_id
      FROM meal_distributions md
      JOIN schools s ON md.school_id = s.id
    `;
    const params = [];
    const conditions = [];

    // Handle date range filtering
    if (startDate && endDate) {
      if (!validateDateFormat(startDate) || !validateDateFormat(endDate)) {
        throw new ValidationError('Invalid date format. Use DD-MM-YYYY (e.g., 15-09-2026)');
      }
      
      const startFormatted = convertDateFormat(startDate);
      const endFormatted = convertDateFormat(endDate);
      
      conditions.push(`md.distribution_date >= $${params.length + 1}`);
      params.push(startFormatted);
      
      conditions.push(`md.distribution_date <= $${params.length + 1}`);
      params.push(endFormatted);
    }

    // Handle school filtering
    if (school_id) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(school_id)) {
        throw new ValidationError('Invalid school ID format');
      }
      conditions.push(`md.school_id = $${params.length + 1}`);
      params.push(school_id);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY md.distribution_date DESC, s.name';

    const result = await pool.query(query, params);
    
    // Convert dates to DD-MM-YYYY format and calculate difference
    const formattedMeals = result.rows.map(record => {
      const mealsPrepared = parseInt(record.meals_prepared) || 0;
      const mealsServed = parseInt(record.meals_served) || 0;
      
      return {
        ...record,
        distribution_date: convertDateToDisplayFormat(record.distribution_date),
        updated_at: convertDateToDisplayFormat(record.updated_at),
        difference: mealsPrepared - mealsServed
      };
    });
    
    res.json({
      success: true,
      meals: formattedMeals,
      count: formattedMeals.length
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message });
    }
    next(new DatabaseError('Failed to retrieve meals report'));
  }
}

/**
 * Get attendance trend data for charts
 */
async function getAttendanceTrend(req, res, next) {
  try {
    const { startDate, endDate, school_id } = req.query;
    
    let query = `
      SELECT 
        attendance_date,
        SUM(total_registered) as total_registered,
        SUM(total_present) as total_present,
        SUM(total_absent) as total_absent
      FROM attendance_records
    `;
    const params = [];
    const conditions = [];

    // Handle date range filtering
    if (startDate && endDate) {
      if (!validateDateFormat(startDate) || !validateDateFormat(endDate)) {
        throw new ValidationError('Invalid date format. Use DD-MM-YYYY (e.g., 15-09-2026)');
      }
      
      const startFormatted = convertDateFormat(startDate);
      const endFormatted = convertDateFormat(endDate);
      
      conditions.push(`attendance_date >= $${params.length + 1}`);
      params.push(startFormatted);
      
      conditions.push(`attendance_date <= $${params.length + 1}`);
      params.push(endFormatted);
    }

    // Handle school filtering
    if (school_id) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(school_id)) {
        throw new ValidationError('Invalid school ID format');
      }
      conditions.push(`school_id = $${params.length + 1}`);
      params.push(school_id);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' GROUP BY attendance_date ORDER BY attendance_date ASC';

    const result = await pool.query(query, params);
    
    // Convert dates to DD-MM-YYYY format and calculate attendance rate
    const trendData = result.rows.map(record => {
      const totalRegistered = parseInt(record.total_registered) || 0;
      const totalPresent = parseInt(record.total_present) || 0;
      const totalAbsent = parseInt(record.total_absent) || 0;
      
      const attendanceRate = totalRegistered > 0 
        ? Math.round((totalPresent / totalRegistered) * 100)
        : 0;
      
      return {
        date: convertDateToDisplayFormat(record.attendance_date),
        total_registered: totalRegistered,
        total_present: totalPresent,
        total_absent: totalAbsent,
        attendance_rate: attendanceRate
      };
    });
    
    res.json({
      success: true,
      trend: trendData,
      count: trendData.length
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message });
    }
    next(new DatabaseError('Failed to retrieve attendance trend'));
  }
}

/**
 * Get meal distribution trend data for charts
 */
async function getMealsTrend(req, res, next) {
  try {
    const { startDate, endDate, school_id } = req.query;
    
    let query = `
      SELECT 
        distribution_date,
        SUM(meals_prepared) as total_prepared,
        SUM(meals_served) as total_served
      FROM meal_distributions
    `;
    const params = [];
    const conditions = [];

    // Handle date range filtering
    if (startDate && endDate) {
      if (!validateDateFormat(startDate) || !validateDateFormat(endDate)) {
        throw new ValidationError('Invalid date format. Use DD-MM-YYYY (e.g., 15-09-2026)');
      }
      
      const startFormatted = convertDateFormat(startDate);
      const endFormatted = convertDateFormat(endDate);
      
      conditions.push(`distribution_date >= $${params.length + 1}`);
      params.push(startFormatted);
      
      conditions.push(`distribution_date <= $${params.length + 1}`);
      params.push(endFormatted);
    }

    // Handle school filtering
    if (school_id) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(school_id)) {
        throw new ValidationError('Invalid school ID format');
      }
      conditions.push(`school_id = $${params.length + 1}`);
      params.push(school_id);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' GROUP BY distribution_date ORDER BY distribution_date ASC';

    const result = await pool.query(query, params);
    
    // Convert dates to DD-MM-YYYY format and calculate difference
    const trendData = result.rows.map(record => {
      const totalPrepared = parseInt(record.total_prepared) || 0;
      const totalServed = parseInt(record.total_served) || 0;
      
      return {
        date: convertDateToDisplayFormat(record.distribution_date),
        total_prepared: totalPrepared,
        total_served: totalServed,
        difference: totalPrepared - totalServed
      };
    });
    
    res.json({
      success: true,
      trend: trendData,
      count: trendData.length
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message });
    }
    next(new DatabaseError('Failed to retrieve meals trend'));
  }
}

module.exports = {
  getDashboardSummary,
  getAttendanceReport,
  getMealsReport,
  getAttendanceTrend,
  getMealsTrend
};
