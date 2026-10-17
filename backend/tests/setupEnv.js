const { testDatabaseUrl } = require('./helpers/testDatabase');

// Point the application's connection pool at the test database before any app module loads.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.NODE_ENV = 'test';
// Test-only signing secret; never used outside the test run
process.env.JWT_SECRET = 'test-only-jwt-secret-0123456789abcdef0123456789';
delete process.env.JWT_EXPIRES_IN;

// Business rules that depend on "today" (the entry window, #62) see a fixed date, so
// tests with fixed record dates keep working: Thursday 8 October 2026, 09:00 in Nairobi.
// Tests that need another day override clock.now themselves.
process.env.SCHOOL_TIMEZONE = 'Africa/Nairobi';
const clock = require('../src/utils/clock');
clock.now = () => new Date('2026-10-08T06:00:00Z');
