/**
 * Live validation for the Attendance and Meals forms. The same rules are enforced
 * by the API and the database; checking here gives immediate feedback on the device.
 */

const WHOLE_NUMBER = /^\d+$/;

/**
 * Parse a form value as a whole number ≥ 0. Returns null for blank or invalid input.
 */
export function toCount(value) {
  const text = String(value ?? '').trim();
  return WHOLE_NUMBER.test(text) ? Number(text) : null;
}

function countError(value, label) {
  if (String(value ?? '').trim() === '') return `Enter the number of ${label}`;
  if (toCount(value) === null) return `${label[0].toUpperCase()}${label.slice(1)} must be a whole number, 0 or more`;
  return null;
}

function dateError(date) {
  return date ? null : 'Enter the date';
}

/**
 * Attendance: every registered learner is counted as either present or absent.
 * Returns { errors: { field: message }, check } where check describes the totals.
 */
export function validateAttendance({ schoolId, date, totalRegistered, totalPresent, totalAbsent }) {
  const errors = {};
  if (!schoolId) errors.schoolId = 'Select the school';
  const missingDate = dateError(date);
  if (missingDate) errors.date = missingDate;
  const registeredError = countError(totalRegistered, 'registered learners');
  const presentError = countError(totalPresent, 'learners present');
  const absentError = countError(totalAbsent, 'learners absent');
  if (registeredError) errors.totalRegistered = registeredError;
  if (presentError) errors.totalPresent = presentError;
  if (absentError) errors.totalAbsent = absentError;

  const registered = toCount(totalRegistered);
  const present = toCount(totalPresent);
  const absent = toCount(totalAbsent);
  let check = null;
  if (registered !== null && present !== null && absent !== null) {
    const counted = present + absent;
    check = { ok: counted === registered, counted, registered, present, absent };
    if (!check.ok) {
      errors.totalAbsent = counted > registered
        ? `Present and absent add up to ${counted}, which is more than the ${registered} registered`
        : `Present and absent add up to ${counted}; ${registered - counted} of the ${registered} registered learners ${registered - counted === 1 ? 'is' : 'are'} not counted`;
    }
  }
  return { errors, check };
}

/**
 * Meals: meals served cannot exceed meals prepared.
 */
export function validateMeals({ schoolId, date, mealsPrepared, mealsServed }) {
  const errors = {};
  if (!schoolId) errors.schoolId = 'Select the school';
  const missingDate = dateError(date);
  if (missingDate) errors.date = missingDate;
  const preparedError = countError(mealsPrepared, 'meals prepared');
  const servedError = countError(mealsServed, 'meals served');
  if (preparedError) errors.mealsPrepared = preparedError;
  if (servedError) errors.mealsServed = servedError;

  const prepared = toCount(mealsPrepared);
  const served = toCount(mealsServed);
  let check = null;
  if (prepared !== null && served !== null) {
    check = { ok: served <= prepared, prepared, served, leftover: prepared - served };
    if (!check.ok) errors.mealsServed = `Meals served (${served}) cannot be more than meals prepared (${prepared})`;
  }
  return { errors, check };
}
