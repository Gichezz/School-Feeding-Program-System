/**
 * Shared validation rules for the records school devices capture.
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

const CLASSES = ['PP1', 'PP2', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6',
  'Grade 7', 'Grade 8', 'Grade 9'];
const COMMODITIES = ['cereals', 'pulses', 'oil', 'salt'];
const MOVEMENT_KINDS = ['delivery', 'purchase', 'loss', 'return', 'reversal'];
// Why feeding did not happen, or why a day was unusual
const NOT_FED_REASONS = ['no_food', 'school_closed', 'cook_absent', 'no_water_or_fuel', 'learners_sent_home'];
const UNUSUAL_REASONS = ['half_day', 'school_event', 'exams', 'visitors_fed'];
const REASON_CODES = [...NOT_FED_REASONS, ...UNUSUAL_REASONS, 'other'];
const MAX_KG = 100000;

function isKg(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_KG
    && Math.round(value * 100) === value * 100;
}

function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

const DATE_ERROR = 'Invalid date. Use a real date in DD-MM-YYYY format (e.g., 15-09-2026)';

/**
 * Termly enrolment for one class and sex. Returns an error message, or null when valid.
 */
function enrolmentError({ schoolId, termId, schoolClass, sex, learners }) {
  if (!isUuid(schoolId)) return 'Invalid school ID format';
  if (!isUuid(termId)) return 'Invalid term ID format';
  if (!CLASSES.includes(schoolClass)) return `Class must be one of ${CLASSES.join(', ')}`;
  if (sex !== 'F' && sex !== 'M') return 'Sex must be F or M';
  if (!isCount(learners)) return `Learners must be a whole number between 0 and ${MAX_COUNT}`;
  return null;
}

/**
 * The daily feeding record. Learners present is optional. Returns an error message,
 * or null when valid.
 */
function feedingError({ schoolId, date, happened, present, fed, cerealsKg, pulsesKg, reasonCode, note }) {
  if (!isUuid(schoolId)) return 'Invalid school ID format';
  if (!isDisplayDate(date)) return DATE_ERROR;
  if (typeof happened !== 'boolean') return 'Say whether feeding happened';
  if (present !== undefined && present !== null && !isCount(present)) {
    return `Learners present must be a whole number between 0 and ${MAX_COUNT}`;
  }
  if (!isCount(fed)) return `Learners fed must be a whole number between 0 and ${MAX_COUNT}`;
  if (![cerealsKg, pulsesKg].every(isKg)) {
    return `Kilograms issued must be between 0 and ${MAX_KG}, to at most 2 decimal places`;
  }
  if (reasonCode !== undefined && reasonCode !== null && !REASON_CODES.includes(reasonCode)) {
    return 'Unknown reason code';
  }
  if (present !== undefined && present !== null && fed > present) return 'Learners fed cannot exceed learners present';
  if (!happened) {
    if (fed !== 0 || cerealsKg !== 0 || pulsesKg !== 0) return 'When feeding did not happen, nobody is fed and nothing is issued';
    if (!reasonCode) return 'Give the reason feeding did not happen';
    if (UNUSUAL_REASONS.includes(reasonCode)) return 'That reason is for a day when feeding happened';
  } else if (NOT_FED_REASONS.includes(reasonCode)) {
    return 'That reason is for a day when feeding did not happen';
  }
  if (reasonCode === 'other' && !hasText(note)) return 'Describe the reason in the note';
  return null;
}

/**
 * A stock ledger entry. Returns an error message, or null when valid.
 */
function movementError({ id, schoolId, date, commodity, kind, quantityKg, noteQuantityKg, reference, note, reversesId, witness }) {
  if (!isUuid(id)) return 'Invalid entry ID format';
  if (!isUuid(schoolId)) return 'Invalid school ID format';
  if (!isDisplayDate(date)) return DATE_ERROR;
  if (!COMMODITIES.includes(commodity)) return `Commodity must be one of ${COMMODITIES.join(', ')}`;
  if (!MOVEMENT_KINDS.includes(kind)) return `Kind must be one of ${MOVEMENT_KINDS.join(', ')}`;
  if (!isKg(quantityKg) || quantityKg === 0) return `Quantity must be more than 0 and at most ${MAX_KG} kg`;
  if (noteQuantityKg !== undefined && noteQuantityKg !== null && (!isKg(noteQuantityKg) || noteQuantityKg === 0)) {
    return 'The quantity on the note must be more than 0 kg';
  }
  if ((kind === 'delivery' || kind === 'purchase') && !hasText(reference)) {
    return kind === 'delivery'
      ? 'A delivery needs its delivery note or dispatch reference'
      : 'A purchase needs its receipt or invoice number';
  }
  if ((kind === 'loss' || kind === 'return') && !hasText(note)) return 'Say why the food left the store';
  if (witness !== undefined && witness !== null && (typeof witness !== 'string' || witness.length > 120)) {
    return 'The witness name must be at most 120 characters';
  }
  if ((kind === 'reversal') !== isUuid(reversesId)) return 'A reversal names the entry it cancels, and only a reversal does';
  return null;
}

/**
 * A physical count of one commodity in the store. Returns an error message, or null.
 */
function countError({ id, schoolId, date, commodity, countedKg }) {
  if (!isUuid(id)) return 'Invalid entry ID format';
  if (!isUuid(schoolId)) return 'Invalid school ID format';
  if (!isDisplayDate(date)) return DATE_ERROR;
  if (!COMMODITIES.includes(commodity)) return `Commodity must be one of ${COMMODITIES.join(', ')}`;
  if (!isKg(countedKg)) return `Counted quantity must be between 0 and ${MAX_KG} kg`;
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
  enrolmentError,
  feedingError,
  movementError,
  countError,
  syncPayloadError,
  CLASSES,
  COMMODITIES,
  REASON_CODES,
};
