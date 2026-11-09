const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client, Pool } = require('pg');
const { testDatabaseUrl, maintenanceDatabaseUrl, databaseName, readSql } = require('./helpers/testDatabase');
const { migrate, migrationFiles } = require('../src/db/migrate');

/**
 * Migrations applied by the API at start-up. Each test gets its own scratch database
 * (never the shared test database) and its own folder of scripts.
 */

const REAL_DIR = path.join(__dirname, '..', '..', 'database', 'migrations');
const quiet = { info: () => {}, warn: () => {} };
const scratchName = `${databaseName(testDatabaseUrl())}_migrations_test`;
const scratchUrl = (() => { const u = new URL(testDatabaseUrl()); u.pathname = `/${scratchName}`; return u.toString(); })();

let db;
let dir;

async function freshDatabase({ schema = true } = {}) {
  const admin = new Client({ connectionString: maintenanceDatabaseUrl() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${scratchName}"`);
  await admin.end();
  db = new Pool({ connectionString: scratchUrl });
  if (schema) await db.query(readSql('schema.sql'));
}

/** A folder holding copies of the real scripts plus any extra ones. */
function scriptsWith(extra = {}) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lishe-migrations-'));
  for (const f of migrationFiles(REAL_DIR)) fs.copyFileSync(path.join(REAL_DIR, f), path.join(dir, f));
  for (const [name, sql] of Object.entries(extra)) fs.writeFileSync(path.join(dir, name), sql);
  return dir;
}

const recorded = async () => (await db.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map((r) => r.name);
const hasTable = async (name) => (await db.query('SELECT to_regclass($1) IS NOT NULL AS ok', [name])).rows[0].ok;

afterEach(async () => {
  if (db) await db.end();
  db = null;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = null;
});
afterAll(async () => {
  const admin = new Client({ connectionString: maintenanceDatabaseUrl() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
  await admin.end();
});

const PROBE = { '999_probe.sql': 'BEGIN;\nCREATE TABLE migration_probe (id INTEGER);\nCOMMIT;\n' };

describe('migrations at start-up', () => {
  it('schema.sql records every script in database/migrations as applied', () => {
    const schema = readSql('schema.sql');
    for (const file of migrationFiles(REAL_DIR)) expect(schema).toContain(`('${file}')`);
  });

  it('applies nothing to a database built from schema.sql', async () => {
    await freshDatabase();

    const result = await migrate({ db, dir: scriptsWith(), log: quiet });

    expect(result.applied).toEqual([]);
  });

  it('applies a new script once, in order, and records it', async () => {
    await freshDatabase();
    scriptsWith(PROBE);

    const first = await migrate({ db, dir, log: quiet });
    const again = await migrate({ db, dir, log: quiet });

    expect(first.applied).toEqual(['999_probe.sql']);
    expect(again.applied).toEqual([]);
    expect(await hasTable('migration_probe')).toBe(true);
    expect(await recorded()).toContain('999_probe.sql');
  });

  it('stops at a script that fails, without recording it, so the API does not start', async () => {
    await freshDatabase();
    scriptsWith({ '998_broken.sql': 'BEGIN;\nALTER TABLE no_such_table ADD COLUMN x INTEGER;\nCOMMIT;\n', ...PROBE });

    await expect(migrate({ db, dir, log: quiet })).rejects.toThrow(/Migration 998_broken.sql failed/);
    expect(await recorded()).not.toContain('998_broken.sql');
    // Later scripts wait for the broken one
    expect(await hasTable('migration_probe')).toBe(false);
  });

  it('waits for a baseline on a database migrated by hand, then applies only the later scripts', async () => {
    await freshDatabase();
    // As before this existed: the schema, but no record of the scripts
    await db.query('DROP TABLE schema_migrations');
    scriptsWith(PROBE);

    const waiting = await migrate({ db, dir, baseline: undefined, log: quiet });
    expect(waiting).toMatchObject({ applied: [], waitingForBaseline: true });
    expect(await hasTable('schema_migrations')).toBe(false);

    const adopted = await migrate({ db, dir, baseline: '17', log: quiet });
    expect(adopted.applied).toEqual(['999_probe.sql']);
    expect(await recorded()).toEqual([...migrationFiles(REAL_DIR), '999_probe.sql'].sort());
  });

  it('refuses a baseline that matches no script', async () => {
    await freshDatabase();
    await db.query('DROP TABLE schema_migrations');

    await expect(migrate({ db, dir: scriptsWith(), baseline: '350', log: quiet })).rejects.toThrow(/MIGRATIONS_BASELINE=350/);
  });

  it('leaves an empty database alone: it starts from schema.sql', async () => {
    await freshDatabase({ schema: false });

    const result = await migrate({ db, dir: scriptsWith(), log: quiet });

    expect(result).toMatchObject({ applied: [], noSchema: true });
    expect(await hasTable('schema_migrations')).toBe(false);
  });
});
