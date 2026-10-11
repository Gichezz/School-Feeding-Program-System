const fs = require('fs');
const path = require('path');

/**
 * Test database configuration.
 * Uses TEST_DATABASE_URL when set; otherwise derives "<database>_test" from the
 * backend connection settings so tests never touch the development database.
 */

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const DATABASE_DIR = path.join(__dirname, '../../../database');

function baseConnectionUrl() {
  if (process.env.DATABASE_URL) {
    return new URL(process.env.DATABASE_URL);
  }
  const url = new URL('postgresql://localhost');
  url.hostname = process.env.PGHOST || 'localhost';
  url.port = process.env.PGPORT || '5432';
  url.username = process.env.PGUSER || 'postgres';
  url.password = process.env.PGPASSWORD || '';
  url.pathname = `/${process.env.PGDATABASE || 'school_feeding'}`;
  return url;
}

function testDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL
    ? new URL(process.env.TEST_DATABASE_URL)
    : (() => {
      const base = baseConnectionUrl();
      base.pathname = `${base.pathname}_test`;
      return base;
    })();

  const name = databaseName(url);
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run tests against "${name}": the test database name must end with "_test"`);
  }
  return url.toString();
}

function maintenanceDatabaseUrl() {
  const url = new URL(testDatabaseUrl());
  url.pathname = '/postgres';
  return url.toString();
}

function databaseName(url) {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

function readSql(file) {
  return fs.readFileSync(path.join(DATABASE_DIR, file), 'utf8');
}

module.exports = {
  testDatabaseUrl,
  maintenanceDatabaseUrl,
  databaseName,
  readSql,
};
