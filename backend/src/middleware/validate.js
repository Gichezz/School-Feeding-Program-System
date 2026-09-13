/**
 * Request validation middleware helpers.
 * Specific validators for attendance/meals/sync will be added later.
 */

function requireJsonBody(req, res, next) {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'JSON body required' });
  }
  return next();
}

module.exports = {
  requireJsonBody,
};
