const { checkDatabaseConnection } = require('../db/pool');

/**
 * Health check controller — confirms the API process is running
 * and the PostgreSQL database connection is available.
 */
async function getHealth(req, res) {
  try {
    const dbConnected = await checkDatabaseConnection();
    
    res.json({
      status: 'ok',
      service: 'school-feeding-backend',
      database: dbConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      service: 'school-feeding-backend',
      database: 'disconnected',
      error: 'Database connection failed',
      timestamp: new Date().toISOString(),
    });
  }
}

module.exports = {
  getHealth,
};
