const jwt = require('jsonwebtoken');
const request = require('supertest');

// Users from database/seed.sql
const USERS = {
  admin: {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    name: 'Programme Administrator',
    email: 'admin@demo-school.local',
    password: 'ChangeMeAdmin1',
    role: 'admin',
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

module.exports = {
  USERS,
  tokenFor,
  api,
};
