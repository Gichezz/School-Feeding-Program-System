/**
 * Health check controller — confirms the API process is running.
 */
function getHealth(req, res) {
  res.json({
    status: 'ok',
    service: 'school-feeding-backend',
    timestamp: new Date().toISOString(),
  });
}

module.exports = {
  getHealth,
};
