const { testDatabaseUrl } = require('./helpers/testDatabase');

// Point the application's connection pool at the test database before any app module loads.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.NODE_ENV = 'test';
// Test-only signing secret; never used outside the test run
process.env.JWT_SECRET = 'test-only-jwt-secret-0123456789abcdef0123456789';
delete process.env.JWT_EXPIRES_IN;
