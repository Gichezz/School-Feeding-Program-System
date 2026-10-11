/**
 * Shared validation rules for attendance and meal distribution records.
 * Used by the REST controllers and by the sync endpoint, so a record is held
 * to the same rules however it reaches the server.
 */

const MAX_COUNT = 100000;

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && uuidRegex.test(value);
}

/**
 * True for a real calendar date in DD-MM-YYYY format (rejects 31-02-2026).
 */
function isDisplayDate(value) {
  const match = typeof value === 'string' && /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!match) return false;
  const [, day, month, year] = match.map(Number);
  if (year < 1900 || year > 2100) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCDate() === day && date.getUTCMonth() === month - 1;
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_COUNT;
}

/**
 * Validate attendance values. Returns an error message, or null when valid.
 */
function attendanceError({ schoolId, date, registered, present, absent }) {
  if (!isUuid(schoolId)) return 'Invalid school ID format';
  if (!isDisplayDate(date)) return 'Invalid date. Use a real date in DD-MM-YYYY format (e.g., 15-09-2026)';
  if (![registered, present, absent].every(isCount)) {
    return `Total registered, present and absent must be whole numbers between 0 and ${MAX_COUNT}`;
  }
  // Every registered learner is counted as either present or absent
  if (present + absent !== registered) return 'Total present + total absent must equal total registered';
  return null;
}

/**
 * Validate meal distribution values. Returns an error message, or null when valid.
 */
function mealError({ schoolId, date, prepared, served }) {
  if (!isUuid(schoolId)) return 'Invalid school ID format';
  if (!isDisplayDate(date)) return 'Invalid date. Use a real date in DD-MM-YYYY format (e.g., 15-09-2026)';
  if (![prepared, served].every(isCount)) {
    return `Meals prepared and served must be whole numbers between 0 and ${MAX_COUNT}`;
  }
  if (served > prepared) return 'Meals served cannot exceed meals prepared';
  return null;
}

/**
 * Validate the payload of a queued sync operation (camelCase fields from the client).
 */
function syncPayloadError(entityType, payload) {
  if (entityType === 'attendance') {
    return attendanceError({
      schoolId: payload.schoolId,
      date: payload.attendanceDate,
      registered: payload.totalRegistered,
      present: payload.totalPresent,
      absent: payload.totalAbsent,
    });
  }
  return mealError({
    schoolId: payload.schoolId,
    date: payload.distributionDate,
    prepared: payload.mealsPrepared,
    served: payload.mealsServed,
  });
}

module.exports = {
  isUuid,
  isDisplayDate,
  attendanceError,
  mealError,
  syncPayloadError,
};
