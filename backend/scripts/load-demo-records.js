#!/usr/bin/env node
/**
 * Load one simulated sub-county's records into a demo database, so the officer screens
 * (weekly review, analytics, conflicts) have two years of history to show.
 *
 * The records come from the synthetic dataset (forecasting/scripts/generate_feeding_dataset.py,
 * which writes forecasting/data/processed/feeding_dataset/). Its schools in one sub-county
 * become the demo sub-county's schools: the first four are the schools in database/seed.sql,
 * the rest are added. Feeding records keep when they were captured and synced, and the
 * injected anomalies are in them, so the weekly review list has something to find.
 *
 * Only for a demo database built from schema.sql, calendar_kenya.sql and seed.sql. It never
 * deletes anything: if the demo schools already have records, it stops.
 *
 *   cd backend
 *   node scripts/load-demo-records.js                     # the database in backend/.env
 *   node scripts/load-demo-records.js --database school_feeding_demo --sub-county "Mfano South"
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');

const DATA_DIR = path.join(__dirname, '..', '..', 'forecasting', 'data', 'processed', 'feeding_dataset');
const DEMO_SUB_COUNTY = 'Mfano Sub-County';
const SEEDED_SCHOOLS = [
  '11111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111112',
  '11111111-1111-1111-1111-111111111113',
  '11111111-1111-1111-1111-111111111114',
];
// Fictional names for the schools added to the demo sub-county
const NEW_SCHOOL_NAMES = ['Mwangaza', 'Tumaini', 'Upendo', 'Baraka', 'Neema', 'Amani', 'Faraja', 'Imani'];
const CLASSES = ['PP1', 'PP2', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6'];
const TIME_ZONE = 'Africa/Nairobi';

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

function connectionString() {
  const database = option('database');
  const url = new URL(process.env.DATABASE_URL || `postgresql://${encodeURIComponent(process.env.PGUSER || 'postgres')}:`
    + `${encodeURIComponent(process.env.PGPASSWORD || '')}@${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432}/`
    + `${process.env.PGDATABASE || 'school_feeding_db'}`);
  if (database) url.pathname = `/${database}`;
  return url;
}

function readCsv(name) {
  const file = path.join(DATA_DIR, `${name}.csv`);
  if (!fs.existsSync(file)) {
    throw new Error(`${file} not found. Generate the dataset first: python forecasting/scripts/generate_feeding_dataset.py`);
  }
  const [header, ...lines] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const keys = header.split(',');
  return lines.map((line) => Object.fromEntries(line.split(',').map((v, i) => [keys[i], v])));
}

/** A stable UUID for a synthetic id, so loading twice into new databases gives the same ids. */
function uuidFor(text) {
  return crypto.createHash('md5').update(text).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

/** A school's enrolment split across classes and girls and boys, adding up to the total. */
function splitEnrolment(total, seed) {
  const weights = CLASSES.map((_, i) => 1.15 - i * 0.03 + ((seed * (i + 3)) % 7) / 100);
  const sum = weights.reduce((a, b) => a + b, 0);
  const perClass = weights.map((w) => Math.floor((total * w) / sum));
  perClass[0] += total - perClass.reduce((a, b) => a + b, 0);
  return CLASSES.flatMap((cls, i) => {
    const girls = Math.round(perClass[i] * (0.49 + ((seed + i) % 5) / 100));
    return [{ class: cls, sex: 'F', learners: girls }, { class: cls, sex: 'M', learners: perClass[i] - girls }];
  });
}

async function main() {
  const url = connectionString();
  const sourceSubCounty = option('sub-county', 'Mfano South');
  const schools = readCsv('schools').filter((s) => s.sub_county === sourceSubCounty);
  if (schools.length === 0) throw new Error(`No schools in "${sourceSubCounty}" in the dataset`);
  console.log(`Loading ${schools.length} schools from "${sourceSubCounty}" into database ${url.pathname.slice(1)} on ${url.hostname}`);

  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const seeded = (await client.query('SELECT id FROM schools WHERE id = ANY($1)', [SEEDED_SCHOOLS])).rows;
    if (seeded.length !== SEEDED_SCHOOLS.length) throw new Error('This is not a demo database: load database/seed.sql first');
    const existing = (await client.query(
      `SELECT (SELECT count(*) FROM daily_feeding f JOIN schools s ON s.id = f.school_id WHERE s.sub_county = $1)
            + (SELECT count(*) FROM stock_movements m JOIN schools s ON s.id = m.school_id WHERE s.sub_county = $1) AS n`,
      [DEMO_SUB_COUNTY]
    )).rows[0].n;
    if (Number(existing) > 0) {
      throw new Error(`The demo sub-county already has ${existing} records. Records are never deleted; start from a new database.`);
    }

    await client.query('BEGIN');
    const ids = {};
    for (const [i, s] of schools.entries()) {
      if (i < SEEDED_SCHOOLS.length) {
        ids[s.school_id] = SEEDED_SCHOOLS[i];
        await client.query('UPDATE schools SET programme_type = $2, sub_county = $3 WHERE id = $1', [ids[s.school_id], s.programme_type, DEMO_SUB_COUNTY]);
      } else {
        ids[s.school_id] = uuidFor(`demo-school-${s.school_id}`);
        const name = `${NEW_SCHOOL_NAMES[(i - SEEDED_SCHOOLS.length) % NEW_SCHOOL_NAMES.length]} Primary School`;
        await client.query(
          `INSERT INTO schools (id, name, location, county, sub_county, programme_type)
           VALUES ($1, $2, 'Sample District', 'Mfano County', $3, $4)`,
          [ids[s.school_id], name, DEMO_SUB_COUNTY, s.programme_type]
        );
      }
    }

    const terms = Object.fromEntries((await client.query('SELECT id, year, term FROM school_terms')).rows.map((t) => [`${t.year}-T${t.term}`, t.id]));
    let rows = 0;
    for (const e of readCsv('enrolment').filter((x) => ids[x.school_id] && terms[x.term_id])) {
      for (const part of splitEnrolment(Number(e.learners), Number(e.school_id.slice(1)))) {
        await client.query(
          'INSERT INTO enrolment (school_id, term_id, class, sex, learners) VALUES ($1, $2, $3, $4, $5)',
          [ids[e.school_id], terms[e.term_id], part.class, part.sex, part.learners]
        );
        rows += 1;
      }
    }
    console.log(`  enrolment: ${rows} class counts`);

    const batches = new Set();
    rows = 0;
    for (const f of readCsv('feeding').filter((x) => ids[x.school_id])) {
      const batch = uuidFor(`demo-batch-${f.school_id}-${f.sync_batch_id}`);
      if (!batches.has(batch)) {
        await client.query(
          `INSERT INTO sync_batches (id, school_id, received_at) VALUES ($1, $2, ($3::date + time '16:00') AT TIME ZONE '${TIME_ZONE}')`,
          [batch, ids[f.school_id], f.received_date]
        );
        batches.add(batch);
      }
      const fed = f.feeding_happened === 'True';
      await client.query(
        `INSERT INTO daily_feeding (school_id, feeding_date, feeding_happened, learners_present, learners_fed, cereals_kg,
                                    pulses_kg, reason_code, note, version, captured_at, received_at, sync_batch_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamp AT TIME ZONE '${TIME_ZONE}',
                 ($12::date + time '16:00') AT TIME ZONE '${TIME_ZONE}', $13)`,
        [ids[f.school_id], f.date, fed, f.learners_present === '' ? null : Math.round(Number(f.learners_present)),
          fed ? Number(f.learners_fed) : 0, fed ? f.cereals_kg : 0, fed ? f.pulses_kg : 0,
          f.reason_code || (fed ? null : 'other'), f.reason_code === 'other' || (!fed && !f.reason_code) ? 'Recorded on paper' : null,
          f.version, f.captured_at, f.received_date, batch]
      );
      rows += 1;
    }
    console.log(`  daily feeding: ${rows} school days`);

    rows = 0;
    for (const m of readCsv('stock_movements').filter((x) => ids[x.school_id])) {
      await client.query(
        `INSERT INTO stock_movements (id, school_id, movement_date, commodity, kind, quantity_kg, note_quantity_kg, reference, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [uuidFor(`demo-movement-${rows}-${m.school_id}-${m.date}-${m.commodity}-${m.kind}`), ids[m.school_id], m.date, m.commodity, m.kind,
          m.quantity_kg, m.note_quantity_kg || null, m.reference || (m.kind === 'purchase' ? `RECEIPT-${m.date}` : null),
          m.kind === 'loss' ? 'Spoiled in the store' : null]
      );
      rows += 1;
    }
    console.log(`  stock movements: ${rows}`);

    rows = 0;
    for (const c of readCsv('stock_counts').filter((x) => ids[x.school_id])) {
      await client.query(
        'INSERT INTO stock_counts (id, school_id, count_date, commodity, counted_kg) VALUES ($1, $2, $3, $4, $5)',
        [uuidFor(`demo-count-${c.school_id}-${c.date}-${c.commodity}`), ids[c.school_id], c.date, c.commodity, c.counted_kg]
      );
      rows += 1;
    }
    console.log(`  stock counts: ${rows}`);

    await client.query("UPDATE users SET sub_county = $1 WHERE role = 'programme_officer' AND sub_county IS DISTINCT FROM $1", [DEMO_SUB_COUNTY]);
    await client.query('COMMIT');
    console.log('Done. Sign in as the demo programme officer to see the weekly review, analytics and conflicts.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
