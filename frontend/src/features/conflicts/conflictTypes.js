import { NOT_FED_REASONS, UNUSUAL_REASONS } from '../feeding/planning';
import { formatDate, formatNumber } from '../../utils/format';

/**
 * How each kind of record in a conflict is shown and merged. A conflict holds the
 * device's record as it sent it (camelCase payload) and the server's row (snake_case).
 * Used by the officer's list (from the server) and the school device's list (from this
 * device), so both compare the same fields.
 *
 * fields: name (payload and merge key), serverName (database column), label, kind
 *   count | kg | yesno | reason | text. Only count and kg fields are edited in a merge.
 */

const REASONS = { ...NOT_FED_REASONS, ...UNUSUAL_REASONS };

const TYPES = {
  daily_feeding: {
    title: 'Daily feeding record',
    when: (local) => formatDate(local?.feedingDate),
    fields: [
      { name: 'feedingHappened', serverName: 'feeding_happened', label: 'Feeding happened', kind: 'yesno' },
      { name: 'learnersPresent', serverName: 'learners_present', label: 'Learners present', kind: 'count', optional: true },
      { name: 'learnersFed', serverName: 'learners_fed', label: 'Learners fed', kind: 'count' },
      { name: 'cerealsKg', serverName: 'cereals_kg', label: 'Cereals issued', kind: 'kg' },
      { name: 'pulsesKg', serverName: 'pulses_kg', label: 'Pulses issued', kind: 'kg' },
      { name: 'reasonCode', serverName: 'reason_code', label: 'Reason', kind: 'reason' },
      { name: 'note', serverName: 'note', label: 'Note', kind: 'text' },
    ],
    // Merging edits counts only, so both versions must agree that learners were fed
    canMerge: (local, server) => local?.feedingHappened === true && server?.feeding_happened === true,
  },
  enrolment: {
    title: 'Enrolment',
    when: (local, conflict) => {
      const who = `${local?.class || ''} ${local?.sex === 'F' ? 'girls' : local?.sex === 'M' ? 'boys' : ''}`.trim();
      return conflict?.termLabel ? `${who}, ${conflict.termLabel}` : who;
    },
    fields: [{ name: 'learners', serverName: 'learners', label: 'Learners enrolled', kind: 'count' }],
    canMerge: () => true,
  },
  attendance: {
    title: 'Attendance',
    when: (local) => formatDate(local?.attendanceDate),
    fields: [
      { name: 'totalRegistered', serverName: 'total_registered', label: 'Registered learners', kind: 'count' },
      { name: 'totalPresent', serverName: 'total_present', label: 'Present', kind: 'count' },
      { name: 'totalAbsent', serverName: 'total_absent', label: 'Absent', kind: 'count' },
    ],
    canMerge: () => true,
  },
  meal_distribution: {
    title: 'Meals',
    when: (local) => formatDate(local?.distributionDate),
    fields: [
      { name: 'mealsPrepared', serverName: 'meals_prepared', label: 'Meals prepared', kind: 'count' },
      { name: 'mealsServed', serverName: 'meals_served', label: 'Meals served', kind: 'count' },
    ],
    canMerge: () => true,
  },
};

const ALIASES = { dailyFeeding: 'daily_feeding', mealDistribution: 'meal_distribution', meals: 'meal_distribution' };

export function conflictType(entityType) {
  return TYPES[ALIASES[entityType] || entityType] || null;
}

export const isEditable = (field) => field.kind === 'count' || field.kind === 'kg';

/** A field's value as shown: numbers formatted, yes/no in words, reason codes as labels. */
export function showValue(field, value) {
  if (value === null || value === undefined || value === '') return '–';
  if (field.kind === 'yesno') return value ? 'Yes' : 'No';
  if (field.kind === 'reason') return REASONS[value] || value;
  if (field.kind === 'kg') return `${Number(value).toLocaleString('en-GB', { maximumFractionDigits: 2 })} kg`;
  if (field.kind === 'count') return formatNumber(value);
  return String(value);
}

function same(field, a, b) {
  const blank = (v) => v === null || v === undefined || v === '';
  if (blank(a) && blank(b)) return true;
  if (field.kind === 'count' || field.kind === 'kg') return Number(a) === Number(b);
  return a === b;
}

/** The device's and the server's value of each field, side by side. */
export function compareRows(type, local, server) {
  return type.fields.map((field) => {
    const device = local?.[field.name];
    const onServer = server?.[field.serverName];
    return { ...field, device, server: onServer, differs: server ? !same(field, device, onServer) : false };
  });
}

/** Values to start a merge from: the server's numbers. */
export function mergeStart(type, local, server) {
  return Object.fromEntries(type.fields.filter(isEditable).map((field) => {
    const value = server?.[field.serverName] ?? local?.[field.name];
    return [field.name, value === null || value === undefined ? '' : String(Number(value))];
  }));
}

/**
 * The values a merge sends: every field the server needs, the edited numbers from the
 * form and the rest (yes/no, reason, note) from the device's version. Returns { values,
 * errors }.
 */
export function mergeValues(type, local, form) {
  const values = {};
  const errors = {};
  for (const field of type.fields) {
    if (!isEditable(field)) {
      values[field.name] = local?.[field.name] ?? null;
      continue;
    }
    const text = String(form[field.name] ?? '').trim();
    if (text === '' && field.optional) { values[field.name] = null; continue; }
    const number = Number(text);
    if (text === '' || !Number.isFinite(number) || number < 0 || (field.kind === 'count' && !Number.isInteger(number))) {
      errors[field.name] = field.kind === 'kg' ? 'Enter kilograms (0 or more)' : 'Enter a whole number (0 or more)';
    } else {
      values[field.name] = number;
    }
  }
  if (!errors.learnersFed && values.learnersPresent != null && values.learnersFed > values.learnersPresent) {
    errors.learnersFed = 'Cannot be more than learners present';
  }
  return { values, errors };
}
