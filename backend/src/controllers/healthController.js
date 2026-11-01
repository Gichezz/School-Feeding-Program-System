const { checkDatabaseConnection } = require('../db/pool');
const { scoringServiceReachable } = require('../services/scoringClient');

/**
 * Health check controller — confirms the API process is running
 * and the PostgreSQL database connection is available. Also says whether the scoring
 * service answers; only the weekly review list needs it, so it does not fail the check.
 */
async function getHealth(req, res) {
  try {
    const [dbConnected, scoring] = await Promise.all([checkDatabaseConnection(), scoringServiceReachable()]);

    res.json({
      status: 'ok',
      service: 'school-feeding-backend',
      database: dbConnected ? 'connected' : 'disconnected',
      scoring: scoring ? 'reachable' : 'unreachable',
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
