const { Client } = require('pg');
const { testDatabaseUrl, maintenanceDatabaseUrl, databaseName, readSql } = require('./helpers/testDatabase');

/**
 * Create a fresh test database and apply the schema once per test run.
 */
module.exports = async function globalSetup() {
  const name = databaseName(testDatabaseUrl());

  const admin = new Client({ connectionString: maintenanceDatabaseUrl() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  const db = new Client({ connectionString: testDatabaseUrl() });
  await db.connect();
  try {
    await db.query(readSql('schema.sql'));
  } finally {
    await db.end();
  }
};
