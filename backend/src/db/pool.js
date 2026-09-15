const { Pool } = require('pg');

/**
 * PostgreSQL connection pool.
 * Uses DATABASE_URL when set; otherwise individual PG* variables.
 * Do not put real passwords in source code.
 */
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool({
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT || 5432),
      database: process.env.PGDATABASE || 'school_feeding',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
    });

async function checkDatabaseConnection() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    return true;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  checkDatabaseConnection,
};
