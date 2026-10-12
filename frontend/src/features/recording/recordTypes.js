import { CalendarCheck, Utensils } from 'lucide-react';
import { getAttendance, getMeals } from '../../services/api';
import {
  getLocalAttendance,
  getLocalAttendanceById,
  saveLocalAttendance,
  updateLocalAttendance,
  getLocalMeals,
  getLocalMealById,
  saveLocalMeal,
  updateLocalMeal,
} from '../../services/localDb';
import { formatNumber, formatShare } from '../../utils/format';
import { toCount, validateAttendance, validateMeals } from './validation';

/**
 * The two kinds of daily record. Attendance and Meals share one page layout
 * (RecordingPage); these configs supply the fields, wording and data calls.
 *
 * fields: the count inputs, keyed by the local record's field name, with the
 *   matching server field name for records that only exist on the server.
 */
export const ATTENDANCE = {
  key: 'attendance',
  title: 'Attendance',
  description: 'Record how many learners are present each school day.',
  formTitle: 'Record attendance',
  editTitle: 'Edit attendance',
  icon: CalendarCheck,
  noun: 'attendance record',
  dateField: 'attendanceDate',
  serverDateField: 'attendance_date',
  fields: [
    { name: 'totalRegistered', serverName: 'total_registered', label: 'Registered learners', hint: 'Everyone on the register today', suffix: 'learners' },
    { name: 'totalPresent', serverName: 'total_present', label: 'Present', hint: 'Learners in school today', suffix: 'learners' },
    { name: 'totalAbsent', serverName: 'total_absent', label: 'Absent', hint: 'Present + absent must equal registered', suffix: 'learners' },
  ],
  validate: validateAttendance,
  // Field that shows the totals rule (present + absent = registered)
  checkField: 'totalAbsent',
  // Shown under the form as the numbers are typed
  liveSummary: (check, values) => {
    if (!check) {
      const registered = toCount(values.totalRegistered);
      const present = toCount(values.totalPresent);
      return registered !== null && present !== null && present <= registered
        ? { tone: 'info', text: `Absent should be ${formatNumber(registered - present)} (registered − present).` }
        : null;
    }
    return check.ok
      ? { tone: 'success', text: `${formatNumber(check.present)} present + ${formatNumber(check.absent)} absent = ${formatNumber(check.registered)} registered. Attendance ${formatShare(check.present, check.registered)}.` }
      : null;
  },
  historyColumns: [
    { key: 'totalRegistered', header: 'Registered', align: 'end' },
    { key: 'totalPresent', header: 'Present', align: 'end' },
    { key: 'totalAbsent', header: 'Absent', align: 'end' },
    { key: 'rate', header: 'Rate', align: 'end', render: (r) => formatShare(r.totalPresent, r.totalRegistered) },
  ],
  emptyHistory: { title: 'No attendance recorded yet', description: 'Records you save appear here, newest first.' },
  savedToast: 'Attendance saved on this device',
  store: {
    loadLocal: getLocalAttendance,
    getLocalById: getLocalAttendanceById,
    saveLocal: saveLocalAttendance,
    updateLocal: updateLocalAttendance,
    loadServer: () => getAttendance().then((res) => res.attendance || []),
  },
};

export const MEALS = {
  key: 'meals',
  title: 'Meals',
  description: 'Record how many meals were prepared and served each school day.',
  formTitle: 'Record meals',
  editTitle: 'Edit meals',
  icon: Utensils,
  noun: 'meal record',
  dateField: 'distributionDate',
  serverDateField: 'distribution_date',
  fields: [
    { name: 'mealsPrepared', serverName: 'meals_prepared', label: 'Meals prepared', hint: 'Plates cooked for today', suffix: 'meals' },
    { name: 'mealsServed', serverName: 'meals_served', label: 'Meals served', hint: 'Cannot be more than prepared', suffix: 'meals' },
  ],
  validate: validateMeals,
  // Field that shows the totals rule (served cannot exceed prepared)
  checkField: 'mealsServed',
  liveSummary: (check) => (check?.ok
    ? { tone: check.leftover > 0 ? 'info' : 'success', text: `${formatNumber(check.served)} of ${formatNumber(check.prepared)} meals served. ${check.leftover > 0 ? `${formatNumber(check.leftover)} left over.` : 'Nothing left over.'}` }
    : null),
  historyColumns: [
    { key: 'mealsPrepared', header: 'Prepared', align: 'end' },
    { key: 'mealsServed', header: 'Served', align: 'end' },
    { key: 'leftover', header: 'Left over', align: 'end', render: (r) => formatNumber((r.mealsPrepared ?? 0) - (r.mealsServed ?? 0)) },
  ],
  emptyHistory: { title: 'No meals recorded yet', description: 'Records you save appear here, newest first.' },
  savedToast: 'Meals saved on this device',
  store: {
    loadLocal: getLocalMeals,
    getLocalById: getLocalMealById,
    saveLocal: saveLocalMeal,
    updateLocal: updateLocalMeal,
    loadServer: () => getMeals().then((res) => res.meals || []),
  },
};
