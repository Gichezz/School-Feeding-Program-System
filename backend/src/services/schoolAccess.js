/**
 * Which schools a signed-in user may see: school staff their own school, programme
 * officers every school in their sub-county, administrators every school.
 */

/** The school if the user may see it, otherwise null. */
async function visibleSchool(db, user, schoolId) {
  const school = (await db.query('SELECT * FROM schools WHERE id = $1', [schoolId])).rows[0];
  if (!school) return null;
  if (user.role === 'admin') return school;
  if (user.role === 'programme_officer') return school.sub_county === user.subCounty ? school : null;
  return school.id === user.schoolId ? school : null;
}

const { ValidationError, NotFoundError } = require('../utils/errors');

/** The sub-county a sub-county view shows: an officer's own; administrators name one. */
function subCountyFor(user, requested) {
  if (user.role === 'programme_officer') {
    if (!user.subCounty) throw new ValidationError('Your account has no sub-county');
    if (requested && requested !== user.subCounty) throw new NotFoundError('Sub-county not found');
    return user.subCounty;
  }
  if (typeof requested !== 'string' || !requested.trim()) throw new ValidationError('subCounty is required');
  return requested.trim();
}

module.exports = { visibleSchool, subCountyFor };
