const { pool } = require('../../src/db/pool');
const { readSql } = require('./testDatabase');

// Identifiers from database/seed.sql
const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';
const MISSING_ID = '99999999-9999-9999-9999-999999999999';
// An approved school device for the seeded staff member's test sessions (see helpers/auth.js)
const TEST_DEVICE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const TABLES = [
  'record_flags',
  'record_history',
  'held_operations',
  'device_users',
  'devices',
  'activation_codes',
  'auth_challenges',
  'recovery_codes',
  'passkey_credentials',
  'conflicts',
  'sync_operations',
  'forecast_results',
  'attendance_records',
  'meal_distributions',
  'students',
  'users',
  'schools',
];

/**
 * Empty every table and reload the seed data.
 */
async function resetDatabase() {
  await pool.query(`TRUNCATE ${TABLES.join(', ')} CASCADE`);
  await pool.query(readSql('seed.sql'));
  await pool.query(
    `INSERT INTO devices (id, school_id, name, status, public_key, approved_at)
     VALUES ($1, $2, 'Test school device', 'approved', '{"kty":"EC","crv":"P-256","x":"test","y":"test"}', NOW())`,
    [TEST_DEVICE_ID, SCHOOL_ID]
  );
}

function attendancePayload(overrides = {}) {
  return {
    schoolId: SCHOOL_ID,
    attendanceDate: '06-10-2026',
    totalRegistered: 100,
    totalPresent: 90,
    totalAbsent: 10,
    ...overrides,
  };
}

function mealPayload(overrides = {}) {
  return {
    schoolId: SCHOOL_ID,
    distributionDate: '06-10-2026',
    mealsPrepared: 100,
    mealsServed: 90,
    ...overrides,
  };
}

function syncOperation(id, entityType, operation, payload, baseVersion) {
  return { id, entityType, operation, payload, baseVersion };
}

module.exports = {
  pool,
  SCHOOL_ID,
  MISSING_ID,
  TEST_DEVICE_ID,
  resetDatabase,
  attendancePayload,
  mealPayload,
  syncOperation,
};
