const { pool } = require('../db/pool');
const { isUuid } = require('../validation/records');
const { visibleSchool } = require('../services/schoolAccess');

/** Whether a person may see a school's records (see services/schoolAccess.js). */
async function schoolInScope(user, schoolId) {
  return Boolean(user && isUuid(schoolId) && (await visibleSchool(pool, user, schoolId)));
}

/**
 * For record and report lists filtered by ?school_id: school staff always get their own
 * school; a programme officer names one school in their sub-county.
 */
async function scopeToSchool(req, res, next) {
  try {
    const { user } = req;
    if (user?.role === 'school_staff') {
      req.query.school_id = user.schoolId;
      return next();
    }
    if (user?.role !== 'programme_officer') {
      return res.status(403).json({ error: 'You do not have permission to do this' });
    }
    if (!req.query.school_id) {
      return res.status(400).json({ error: 'Choose a school' });
    }
    // A malformed ID is refused by the endpoint itself, with its own message
    if (!isUuid(req.query.school_id)) return next();
    if (!(await schoolInScope(user, req.query.school_id))) {
      return res.status(403).json({ error: 'You do not have permission to do this' });
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { schoolInScope, scopeToSchool };
