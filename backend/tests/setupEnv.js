const { testDatabaseUrl } = require('./helpers/testDatabase');

// Point the application's connection pool at the test database before any app module loads.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.NODE_ENV = 'test';
