import { getAttendanceReport, getMealsReport, getSchools } from '../../services/api';
import { cacheSchools, getCachedSchools, getLocalAttendance, getLocalMeals } from '../../services/localDb';
import { mergeLocalAndServerRecords } from '../../utils/mergeRecords';
import { formatDate, formatNumber, toDate } from '../../utils/format';

/**
 * Data shared by the Dashboard and Reports: attendance and meal records for a date
 * range, from the server merged with records still only on this device. When the
 * server cannot be reached, the device's own records are used.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * True when a date (any supported format) falls inside { start, end } (DD-MM-YYYY, inclusive).
 */
export function isInRange(value, range) {
  const date = toDate(value);
  const start = toDate(range.start);
  const end = toDate(range.end);
  if (!date || !start || !end) return false;
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return day >= start && day <= end;
}

/**
 * The period of the same length just before `range`, for "compared with" changes.
 */
export function previousRange(range) {
  const start = toDate(range.start);
  const end = toDate(range.end);
  if (!start || !end) return null;
  const days = Math.round((end - start) / DAY_MS) + 1;
  const prevEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
  const prevStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - days);
  return { start: formatDate(prevStart), end: formatDate(prevEnd) };
}

/**
 * Attendance record (device or server) in one display shape.
 */
export function toAttendanceRow(record, schoolNames = {}) {
  const isLocal = record.syncStatus !== undefined;
  const schoolId = record.schoolId || record.school_id;
  return {
    key: `${isLocal ? 'local' : 'server'}-attendance-${record.id}`,
    date: formatDate(isLocal ? record.attendanceDate : record.attendance_date),
    schoolName: record.school_name || schoolNames[schoolId] || '',
    registered: count(isLocal ? record.totalRegistered : record.total_registered),
    present: count(isLocal ? record.totalPresent : record.total_present),
    absent: count(isLocal ? record.totalAbsent : record.total_absent),
    unsynced: isLocal && record.syncStatus !== 'synced',
  };
}

/**
 * Meal record (device or server) in one display shape. Waste = prepared − served.
 */
export function toMealRow(record, schoolNames = {}) {
  const isLocal = record.syncStatus !== undefined;
  const schoolId = record.schoolId || record.school_id;
  const prepared = count(isLocal ? record.mealsPrepared : record.meals_prepared);
  const served = count(isLocal ? record.mealsServed : record.meals_served);
  return {
    key: `${isLocal ? 'local' : 'server'}-meal-${record.id}`,
    date: formatDate(isLocal ? record.distributionDate : record.distribution_date),
    schoolName: record.school_name || schoolNames[schoolId] || '',
    prepared,
    served,
    waste: prepared - served,
    unsynced: isLocal && record.syncStatus !== 'synced',
  };
}

function byDateDescending(a, b) {
  return toDate(b.date) - toDate(a.date) || a.schoolName.localeCompare(b.schoolName);
}

/**
 * Totals for the stat cards. rate is a ratio (0–1), or null when nobody is registered.
 */
export function summarise(attendance, meals) {
  const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0);
  const registered = sum(attendance, 'registered');
  const present = sum(attendance, 'present');
  const prepared = sum(meals, 'prepared');
  const served = sum(meals, 'served');
  return {
    registered,
    present,
    absent: sum(attendance, 'absent'),
    rate: registered > 0 ? present / registered : null,
    prepared,
    served,
    waste: prepared - served,
    attendanceRecords: attendance.length,
    mealRecords: meals.length,
  };
}

/**
 * One entry per date (oldest first) with all schools added together, for charts.
 * rate is a percentage (0–100) so it reads naturally on a chart axis.
 */
export function dailyTotals(attendance, meals) {
  const days = new Map();
  const day = (date) => {
    if (!days.has(date)) days.set(date, { date, registered: 0, present: 0, prepared: 0, served: 0 });
    return days.get(date);
  };
  for (const row of attendance) {
    const entry = day(row.date);
    entry.registered += row.registered;
    entry.present += row.present;
  }
  for (const row of meals) {
    const entry = day(row.date);
    entry.prepared += row.prepared;
    entry.served += row.served;
  }
  return [...days.values()]
    .map((entry) => ({
      ...entry,
      rate: entry.registered > 0 ? (entry.present / entry.registered) * 100 : null,
      waste: entry.prepared - entry.served,
    }))
    .sort((a, b) => toDate(a.date) - toDate(b.date));
}

async function loadSchoolNames() {
  let schools = [];
  try {
    schools = (await getSchools()).schools || [];
    await cacheSchools(schools);
  } catch {
    schools = await getCachedSchools().catch(() => []);
  }
  return Object.fromEntries(schools.map((school) => [school.id, school.name]));
}

const COMPARED = 'vs previous period';

/**
 * Change from the previous period for a stat card, or undefined when there is
 * nothing to compare with. higherIsGood decides the colour.
 */
export function changeFrom(current, previous, { higherIsGood = true, points = false } = {}) {
  if (current === null || previous === null || previous === undefined) return undefined;
  const difference = current - previous;
  const rounded = points ? Math.round(difference * 1000) / 10 : Math.round(difference);
  const direction = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
  const size = points ? `${Math.abs(rounded).toFixed(1)} pts` : formatNumber(Math.abs(rounded));
  const sign = { up: '+', down: '−', flat: '' }[direction];
  return {
    value: direction === 'flat' ? 'No change' : `${sign}${size}`,
    direction,
    good: direction === 'up' ? higherIsGood : !higherIsGood,
    label: direction === 'flat' ? undefined : COMPARED,
  };
}

/**
 * Records in `range`, newest first.
 * @returns {Promise<{ attendance: object[], meals: object[], fromDevice: boolean }>}
 */
export async function loadRecords(range, { schoolNames } = {}) {
  const names = schoolNames || (await loadSchoolNames());
  const [localAttendance, localMeals] = await Promise.all([
    getLocalAttendance().catch(() => []),
    getLocalMeals().catch(() => []),
  ]);
  const deviceAttendance = localAttendance.filter((r) => isInRange(r.attendanceDate, range));
  const deviceMeals = localMeals.filter((r) => isInRange(r.distributionDate, range));

  let serverAttendance = [];
  let serverMeals = [];
  let fromDevice = false;
  try {
    const params = { startDate: range.start, endDate: range.end };
    const [attendanceResponse, mealsResponse] = await Promise.all([
      getAttendanceReport(params),
      getMealsReport(params),
    ]);
    serverAttendance = attendanceResponse.attendance || [];
    serverMeals = mealsResponse.meals || [];
  } catch {
    fromDevice = true;
  }

  const attendance = mergeLocalAndServerRecords(deviceAttendance, serverAttendance, {
    localDateField: 'attendanceDate',
    serverDateField: 'attendance_date',
  }).map((record) => toAttendanceRow(record, names));
  const meals = mergeLocalAndServerRecords(deviceMeals, serverMeals, {
    localDateField: 'distributionDate',
    serverDateField: 'distribution_date',
  }).map((record) => toMealRow(record, names));

  return {
    attendance: attendance.sort(byDateDescending),
    meals: meals.sort(byDateDescending),
    fromDevice,
  };
}

/**
 * Records for `range` and for the period before it (for the stat card changes).
 */
export async function loadInsights(range) {
  const schoolNames = await loadSchoolNames();
  const before = previousRange(range);
  const [current, previous] = await Promise.all([
    loadRecords(range, { schoolNames }),
    before ? loadRecords(before, { schoolNames }) : null,
  ]);
  return { ...current, previous };
}
