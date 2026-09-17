const { pool } = require('../db/pool');
const { NotFoundError, ValidationError, DatabaseError } = require('../utils/errors');

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
 * Get all meal distribution records with optional filtering by school and/or date
 */
async function getMeals(req, res, next) {
  try {
    const { school_id, date } = req.query;
    
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

    if (school_id) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(school_id)) {
        return res.status(400).json({ error: 'Invalid school ID format' });
      }
      conditions.push(`md.school_id = $${params.length + 1}`);
      params.push(school_id);
    }

    if (date) {
      conditions.push(`md.distribution_date = $${params.length + 1}`);
      params.push(convertDateFormat(date));
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY md.distribution_date DESC, s.name';

    const result = await pool.query(query, params);
    
    // Convert dates to DD-MM-YYYY format for API response
    const formattedMeals = result.rows.map(record => ({
      ...record,
      distribution_date: convertDateToDisplayFormat(record.distribution_date),
      updated_at: convertDateToDisplayFormat(record.updated_at),
    }));
    
    res.json({
      meals: formattedMeals,
      count: formattedMeals.length,
    });
  } catch (error) {
    next(new DatabaseError('Failed to retrieve meal distribution records'));
  }
}

/**
 * Get a single meal distribution record by ID
 */
async function getMealById(req, res, next) {
  try {
    const { id } = req.params;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: 'Invalid meal distribution ID format' });
    }

    const result = await pool.query(
      `SELECT 
        md.id, md.school_id, s.name as school_name,
        md.distribution_date, md.meals_prepared, md.meals_served,
        md.version, md.updated_at, md.updated_by, md.client_id
      FROM meal_distributions md
      JOIN schools s ON md.school_id = s.id
      WHERE md.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Meal distribution record not found');
    }

    // Convert dates to DD-MM-YYYY format for API response
    const formattedRecord = {
      ...result.rows[0],
      distribution_date: convertDateToDisplayFormat(result.rows[0].distribution_date),
      updated_at: convertDateToDisplayFormat(result.rows[0].updated_at),
    };

    res.json({ meal: formattedRecord });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    next(error);
  }
}

/**
 * Create a new meal distribution record
 */
async function createMeal(req, res, next) {
  try {
    const { school_id, distribution_date, meals_prepared, meals_served, updated_by, client_id } = req.body;

    // Validate required fields
    if (!school_id || !distribution_date || meals_prepared === undefined || meals_served === undefined) {
      throw new ValidationError('Missing required fields: school_id, distribution_date, meals_prepared, meals_served');
    }

    // Validate school_id format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(school_id)) {
      throw new ValidationError('Invalid school ID format');
    }

    // Validate date format (DD-MM-YYYY)
    if (!validateDateFormat(distribution_date)) {
      throw new ValidationError('Invalid date format. Use DD-MM-YYYY (e.g., 15-09-2026)');
    }

    // Validate non-negative values
    if (meals_prepared < 0 || meals_served < 0) {
      throw new ValidationError('Meals prepared and served must be non-negative');
    }

    // Validate that served <= prepared
    if (meals_served > meals_prepared) {
      throw new ValidationError('Meals served cannot exceed meals prepared');
    }

    // Validate updated_by format if provided
    if (updated_by && !uuidRegex.test(updated_by)) {
      throw new ValidationError('Invalid user ID format');
    }

    const query = `
      INSERT INTO meal_distributions 
        (school_id, distribution_date, meals_prepared, meals_served, updated_by, client_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING 
        id, school_id, distribution_date, meals_prepared, meals_served,
        version, updated_at, updated_by, client_id
    `;

    const values = [
      school_id,
      convertDateFormat(distribution_date),
      meals_prepared,
      meals_served,
      updated_by || null,
      client_id || null,
    ];

    const result = await pool.query(query, values);

    // Convert dates to DD-MM-YYYY format for API response
    const formattedRecord = {
      ...result.rows[0],
      distribution_date: convertDateToDisplayFormat(result.rows[0].distribution_date),
      updated_at: convertDateToDisplayFormat(result.rows[0].updated_at),
    };

    res.status(201).json({
      meal: formattedRecord,
      message: 'Meal distribution record created successfully',
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
}

module.exports = {
  getMeals,
  getMealById,
  createMeal,
};
