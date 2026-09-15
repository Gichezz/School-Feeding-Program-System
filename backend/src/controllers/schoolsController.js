const { pool } = require('../db/pool');
const { NotFoundError, DatabaseError } = require('../utils/errors');

/**
 * Get all schools
 */
async function getSchools(req, res, next) {
  try {
    const result = await pool.query(
      'SELECT id, name, location, created_at, updated_at FROM schools ORDER BY name'
    );
    
    res.json({
      schools: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    next(new DatabaseError('Failed to retrieve schools'));
  }
}

/**
 * Get a single school by ID
 */
async function getSchoolById(req, res, next) {
  try {
    const { id } = req.params;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: 'Invalid school ID format' });
    }

    const result = await pool.query(
      'SELECT id, name, location, created_at, updated_at FROM schools WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('School not found');
    }

    res.json({ school: result.rows[0] });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    next(error);
  }
}

module.exports = {
  getSchools,
  getSchoolById,
};
