// Run directly (`npm run migrate`): read backend/.env before the pool is created
if (require.main === module) require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

/**
 * Database migrations, applied by the API itself when it starts, so an update needs no
 * one to run psql by hand.
 *
 * schema_migrations records each script in database/migrations/ that the database has.
 * A database built from schema.sql already has the latest schema, and schema.sql records
 * every script as applied, so nothing runs. On start-up the scripts not yet recorded are
 * applied in order and recorded.
 *
 * A database that was migrated by hand before this existed has no record of what it
 * has. Older scripts are not safe to run again on a newer schema, so the API does not
 * guess: set MIGRATIONS_BASELINE to the last script applied by hand (for example 016)
 * once, and the later ones are applied. Until then it applies nothing and says so.
 */

const DEFAULT_DIR = path.resolve(__dirname, '..', '..', '..', 'database', 'migrations');
// One process migrates at a time
const LOCK_KEY = 72018;

function migrationsDir() {
  return process.env.MIGRATIONS_DIR || DEFAULT_DIR;
}

/** The scripts, in order: 001_..., 002_..., by their number. */
function migrationFiles(dir = migrationsDir()) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
}

const numberOf = (file) => file.slice(0, 3);

async function tableExists(client, name) {
  return (await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [name])).rows[0].ok;
}

/**
 * Apply the scripts the database does not have. Returns what was applied (and why
 * nothing was, when it could not tell). Throws when a script fails, so the API does not
 * start on a half-migrated schema.
 */
async function migrate({ db = pool, dir = migrationsDir(), baseline = process.env.MIGRATIONS_BASELINE, log = console } = {}) {
  const files = migrationFiles(dir);
  const client = await db.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      if (!(await tableExists(client, 'schema_migrations'))) {
        if (!(await tableExists(client, 'schools'))) {
          // The scripts change an existing schema; a new database starts from schema.sql
          log.warn('Migrations: the database has no tables yet. Load database/schema.sql first.');
          return { applied: [], noSchema: true };
        }
        // Migrated by hand before: only a stated baseline says what it already has
        if (!baseline) {
          log.warn('Migrations: this database has no record of the scripts it has. Set MIGRATIONS_BASELINE to the '
            + 'last script in database/migrations applied by hand (for example 016), then start again.');
          return { applied: [], waitingForBaseline: true };
        }
        if (!files.some((f) => numberOf(f) === String(baseline).padStart(3, '0'))) {
          throw new Error(`MIGRATIONS_BASELINE=${baseline} matches no script in ${dir}`);
        }
        await client.query(
          `CREATE TABLE IF NOT EXISTS schema_migrations (
             name        TEXT PRIMARY KEY,
             applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
           )`
        );
        const upTo = String(baseline).padStart(3, '0');
        for (const file of files.filter((f) => numberOf(f) <= upTo)) {
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
        }
      }

      const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
      const applied = [];
      for (const file of files.filter((f) => !done.has(f))) {
        try {
          await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
        } catch (error) {
          // A script opens its own transaction; end it if it failed part-way
          await client.query('ROLLBACK').catch(() => {});
          throw new Error(`Migration ${file} failed: ${error.message}`);
        }
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        applied.push(file);
      }
      if (applied.length) log.info(`Migrations: applied ${applied.join(', ')}`);
      return { applied, waitingForBaseline: false };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

module.exports = { migrate, migrationFiles, migrationsDir };

// `npm run migrate`: apply them without starting the API
if (require.main === module) {
  migrate()
    .then((result) => {
      if (!result.waitingForBaseline && !result.noSchema && result.applied.length === 0) console.log('Migrations: the database is up to date');
      return pool.end();
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
