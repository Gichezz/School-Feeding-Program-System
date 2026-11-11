const jwt = require('jsonwebtoken');
const request = require('supertest');

// Users from database/seed.sql
const USERS = {
  admin: {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    name: 'System Administrator',
    email: 'admin@demo-school.local',
    password: 'ChangeMeAdmin1',
    role: 'admin',
  },
  officer: {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3',
    name: 'Sub-County Programme Officer',
    email: 'officer@demo-school.local',
    password: 'ChangeMeOfficer1',
    role: 'programme_officer',
  },
  staff: {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
    name: 'School Feeding Officer',
    email: 'staff@demo-school.local',
    password: 'ChangeMeStaff1',
    role: 'school_staff',
  },
};

// Matches TEST_DEVICE_ID in helpers/fixtures.js (an approved device at the demo school)
const TEST_DEVICE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

/**
 * A session token for a seeded user, signed the same way as the sign-in endpoints.
 * School staff sessions belong to the approved test device, as after a device sign-in.
 */
function tokenFor(userKey, options = {}) {
  const user = USERS[userKey];
  const device = user.role === 'school_staff' ? { dev: TEST_DEVICE_ID } : {};
  return jwt.sign(
    { name: user.name, email: user.email, role: user.role, ...device },
    process.env.JWT_SECRET,
    { subject: user.id, expiresIn: '1h', algorithm: 'HS256', ...options }
  );
}

/**
 * Supertest helpers that send requests as a signed-in user (admin by default).
 */
function api(app, userKey = 'admin') {
  const header = `Bearer ${tokenFor(userKey)}`;
  return {
    get: (url) => request(app).get(url).set('Authorization', header),
    post: (url) => request(app).post(url).set('Authorization', header),
    put: (url) => request(app).put(url).set('Authorization', header),
    patch: (url) => request(app).patch(url).set('Authorization', header),
    delete: (url) => request(app).delete(url).set('Authorization', header),
  };
}

/**
 * Sends to the sync endpoint as the feeding teacher of the school the operations belong to,
 * on an approved device at that school. Only school devices send records, so tests that
 * record at several schools use this. Other schools' teachers are created on first use.
 */
function asSchool(app) {
  const { pool } = require('../../src/db/pool');
  const SEEDED_SCHOOL = '11111111-1111-1111-1111-111111111111';
  async function headerFor(schoolId) {
    // The seeded teacher sends for their school, and for a malformed id the endpoint refuses
    if (!/^[0-9a-f-]{36}$/i.test(schoolId || '') || schoolId === SEEDED_SCHOOL) return `Bearer ${tokenFor('staff')}`;
    const suffix = schoolId.slice(-12);
    const userId = `bbbbbbbb-bbbb-bbbb-bbbb-${suffix}`;
    const deviceId = `dddddddd-dddd-dddd-dddd-${suffix}`;
    await pool.query(
      `INSERT INTO users (id, name, email, password_hash, role, school_id)
       VALUES ($1, 'Feeding teacher', $2, 'not-a-real-password-hash-for-tests', 'school_staff', $3) ON CONFLICT (id) DO NOTHING`,
      [userId, `teacher-${suffix}@test.local`, schoolId]
    );
    await pool.query(
      `INSERT INTO devices (id, school_id, name, status, public_key, approved_at)
       VALUES ($1, $2, 'Test school device', 'approved', '{"kty":"EC","crv":"P-256","x":"test","y":"test"}', NOW())
       ON CONFLICT (id) DO NOTHING`,
      [deviceId, schoolId]
    );
    const token = jwt.sign({ name: 'Feeding teacher', role: 'school_staff', dev: deviceId }, process.env.JWT_SECRET,
      { subject: userId, expiresIn: '1h', algorithm: 'HS256' });
    return `Bearer ${token}`;
  }
  async function sync(body) {
    const operations = Array.isArray(body?.operations) ? body.operations : [];
    const schools = [...new Set(operations.map((op) => op.payload?.schoolId).filter(Boolean))];
    if (schools.length > 1) throw new Error('asSchool: one school per request');
    return request(app).post('/api/sync').set('Authorization', await headerFor(schools[0])).send(body);
  }
  // Used like api(): school.post('/api/sync').send(body)
  return { sync, post: () => ({ send: sync }) };
}

module.exports = {
  USERS,
  tokenFor,
  api,
  asSchool,
};
