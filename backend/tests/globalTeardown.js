const { Client } = require('pg');
const { testDatabaseUrl, maintenanceDatabaseUrl, databaseName } = require('./helpers/testDatabase');

/**
 * Drop the test database after the run.
 */
module.exports = async function globalTeardown() {
  const admin = new Client({ connectionString: maintenanceDatabaseUrl() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName(testDatabaseUrl())}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
};
