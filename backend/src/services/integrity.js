const clock = require('../utils/clock');
const { schoolTimezone, localDate, schoolDaysBetween } = require('../validation/entryWindow');

/**
 * Record integrity (#62). After an attendance or meal record is saved, this:
 *   1. stores who captured it, on which device, when (device time) and when it reached
 *      the server, plus the reason for a late entry;
 *   2. adds the saved version to record_history (who changed what, and when);
 *   3. flags it for an administrator to check when something looks unusual. Flags never
 *      block a record: they make misuse visible, alongside paper-register spot checks.
 */

const TABLES = { attendance: 'attendance_records', meal_distribution: 'meal_distributions' };
const DATE_COLUMNS = { attendance: 'attendance_date', meal_distribution: 'distribution_date' };

const FLAGS = {
  outside_hours: 'Captured outside school hours',
  entered_late: 'Entered late',
  synced_late: 'Kept offline for a long time before it synced',
  served_exceeds_present: 'More meals served than learners present',
  unusual_numbers: "Far from the school's usual numbers",
};

// Meals served may exceed learners present a little (staff, visitors) before it is flagged
const SERVED_MARGIN = 1.1;
const USUAL_HISTORY = 20;
const USUAL_MIN_RECORDS = 10;

function settings() {
  return {
    timeZone: schoolTimezone(),
    dayStart: process.env.SCHOOL_DAY_START || '06:00',
    dayEnd: process.env.SCHOOL_DAY_END || '18:00',
    offlineHours: Number(process.env.OFFLINE_FLAG_HOURS) || 72,
  };
}

function localTime(moment, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(moment);
  return `${parts.find((p) => p.type === 'hour').value}:${parts.find((p) => p.type === 'minute').value}`;
}

/**
 * A DATE column as YYYY-MM-DD. pg returns DATE as local midnight, so use local parts
 * (toISOString would shift it back a day in time zones ahead of UTC).
 */
function isoDate(value) {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const pad = (n) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function displayDate(iso) {
  const [year, month, day] = iso.split('-');
  return `${day}-${month}-${year}`;
}

function valuesOf(entityType, row) {
  return entityType === 'attendance'
    ? { date: displayDate(isoDate(row.attendance_date)), registered: row.total_registered, present: row.total_present, absent: row.total_absent }
    : { date: displayDate(isoDate(row.distribution_date)), prepared: row.meals_prepared, served: row.meals_served };
}

async function addFlag(client, entityType, row, flag, detail) {
  await client.query(
    `INSERT INTO record_flags (entity_type, record_id, version, flag, detail)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (entity_type, record_id, version, flag) DO NOTHING`,
    [entityType, row.id, row.version, flag, detail]
  );
}

/**
 * Compare with the school's previous records (other dates): far outside the usual
 * range when more than 3 standard deviations from the mean, with a floor on the spread
 * so a very steady school does not flag tiny changes.
 */
async function unusual(client, entityType, row) {
  const column = entityType === 'attendance' ? 'total_present' : 'meals_served';
  const dateColumn = DATE_COLUMNS[entityType];
  const previous = await client.query(
    `SELECT ${column} AS value FROM ${TABLES[entityType]}
     WHERE school_id = $1 AND ${dateColumn} <> $2
     ORDER BY ${dateColumn} DESC LIMIT ${USUAL_HISTORY}`,
    [row.school_id, row[dateColumn]]
  );
  const values = previous.rows.map((r) => Number(r.value));
  if (values.length < USUAL_MIN_RECORDS) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  const spread = Math.max(sd, mean * 0.05, 2);
  const value = Number(row[column]);
  if (Math.abs(value - mean) <= 3 * spread) return null;
  const what = entityType === 'attendance' ? 'learners present' : 'meals served';
  return `${value} ${what}; usually about ${Math.round(mean)}`;
}

async function servedVersusPresent(client, mealRow) {
  const attendance = await client.query(
    'SELECT total_present FROM attendance_records WHERE school_id = $1 AND attendance_date = $2',
    [mealRow.school_id, mealRow.distribution_date]
  );
  const present = attendance.rows[0]?.total_present;
  if (present === undefined || mealRow.meals_served <= present * SERVED_MARGIN) return null;
  return `${mealRow.meals_served} meals served but ${present} learners present`;
}

async function flagRecord(client, entityType, row, { late }) {
  const { timeZone, dayStart, dayEnd, offlineHours } = settings();
  const moment = row.captured_at || row.received_at;

  const time = moment ? localTime(moment, timeZone) : null;
  if (time && (time < dayStart || time >= dayEnd)) {
    await addFlag(client, entityType, row, 'outside_hours', `Captured at ${time}, outside school hours (${dayStart}–${dayEnd})`);
  }

  if (late) {
    const recordIso = isoDate(row[DATE_COLUMNS[entityType]]);
    const days = schoolDaysBetween(recordIso, localDate(moment || new Date(), timeZone));
    await addFlag(client, entityType, row, 'entered_late', `Entered ${days} school days after the date. Reason: ${row.late_reason}`);
  }

  if (row.captured_at && row.received_at) {
    const hours = (row.received_at - row.captured_at) / 3600000;
    if (hours > offlineHours) {
      await addFlag(client, entityType, row, 'synced_late', `Kept on the device for ${Math.floor(hours / 24)} days before it synced`);
    }
  }

  if (entityType === 'meal_distribution') {
    const detail = await servedVersusPresent(client, row);
    if (detail) await addFlag(client, entityType, row, 'served_exceeds_present', detail);
  } else {
    // A new attendance count can make that day's meal record look wrong
    const meal = (await client.query(
      'SELECT * FROM meal_distributions WHERE school_id = $1 AND distribution_date = $2',
      [row.school_id, row.attendance_date]
    )).rows[0];
    const detail = meal && (await servedVersusPresent(client, meal));
    if (detail) await addFlag(client, 'meal_distribution', meal, 'served_exceeds_present', detail);
  }

  const unusualDetail = await unusual(client, entityType, row);
  if (unusualDetail) await addFlag(client, entityType, row, 'unusual_numbers', unusualDetail);
}

/**
 * Call after every create or update of an attendance or meal record.
 * capture: { capturedBy, deviceId, capturedAt } (capturedAt is a Date or null)
 * flag: false for administrators' own decisions (e.g. resolving a conflict)
 */
async function afterRecordSaved(client, { entityType, recordId, capture = {}, lateReason = null, late = false, flag = true }) {
  const table = TABLES[entityType];
  const row = (await client.query(
    `UPDATE ${table}
     SET captured_by = $2, device_id = $3, captured_at = $4, received_at = $6, late_reason = $5
     WHERE id = $1
     RETURNING *`,
    [recordId, capture.capturedBy || null, capture.deviceId || null, capture.capturedAt || null, lateReason || null, clock.now()]
  )).rows[0];
  if (!row) return;

  await client.query(
    `INSERT INTO record_history (entity_type, record_id, version, values, changed_by, device_id, captured_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [entityType, row.id, row.version, JSON.stringify(valuesOf(entityType, row)), row.updated_by || capture.capturedBy || null, row.device_id, row.captured_at]
  );

  if (flag) await flagRecord(client, entityType, row, { late });
}

module.exports = {
  FLAGS,
  afterRecordSaved,
  valuesOf,
};
