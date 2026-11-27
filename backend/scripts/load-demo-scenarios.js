#!/usr/bin/env node
/**
 * Demonstration scenarios for the officer's screens, on top of the demo records
 * (scripts/load-demo-records.js). Run it inside the running API container:
 *
 *   docker compose exec backend node scripts/load-demo-scenarios.js
 *
 * First it gives every school in the sub-county ordinary days in the practice term
 * (database/demo/practice_term.sql), up to yesterday, and the term's food on opening day,
 * so the officer's term figures are not empty.
 *
 * Then every scenario record goes through the real sync endpoint, as a feeding teacher at
 * Jaribio Primary School on two school devices, so the server's own checks decide what
 * becomes a conflict, what is held and what is flagged. It adds:
 *   - two conflicts: the same day recorded on both devices with different numbers, and
 *     the same day edited on both devices from the same version;
 *   - a held delivery: the same delivery note recorded on both devices;
 *   - flagged records: a short delivery, a day captured at night, a day kept offline for
 *     days, a day entered late with a reason and half the cereals ration, and more learners
 *     fed than enrolled;
 * then scores Term 3 2026's weeks that are not scored yet, and prints which schools each
 * week lists, so a presenter can pick a week that shows a given kind of problem.
 *
 * Only for a demo database. It refuses to run twice (the scenario teacher exists).
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool } = require('../src/db/pool');
const { scoreWeek } = require('../src/services/reviewRuns');

const API = process.argv.includes('--api') ? process.argv[process.argv.indexOf('--api') + 1] : `http://localhost:${process.env.PORT || 5000}`;
const SCHOOL = '11111111-1111-1111-1111-111111111112'; // Jaribio Primary School in database/seed.sql
const TEACHER = { id: 'cccccccc-cccc-4ccc-8ccc-000000000001', name: 'Wanjiru Kamau', email: 'wanjiru.kamau@demo-school.local' };
const DEVICES = {
  store: { id: 'cccccccc-cccc-4ccc-8ccc-0000000000d1', name: 'Store tablet', clientId: 'demo-store-tablet' },
  phone: { id: 'cccccccc-cccc-4ccc-8ccc-0000000000d2', name: "Head teacher's phone", clientId: 'demo-head-phone' },
};
const TIME_ZONE = 'Africa/Nairobi';
const PLACEHOLDER_KEY = '{"kty":"EC","crv":"P-256","x":"demo","y":"demo"}';

const pad = (n) => String(n).padStart(2, '0');
const display = (iso) => iso.split('-').reverse().join('-');
/** A moment on a school-local date: "2026-11-20", "07:30" → ISO string. Nairobi is UTC+3 all year. */
const at = (iso, time) => new Date(`${iso}T${time}:00+03:00`).toISOString();

let opCount = 0;
function op(entityType, operation, payload, baseVersion, device, capturedAt) {
  opCount += 1;
  return {
    id: `demo-scenario-${Date.now()}-${opCount}`,
    entityType, operation, payload, baseVersion,
    capturedBy: TEACHER.id, deviceId: device.id, capturedAt,
  };
}

async function sync(device, operations) {
  const token = jwt.sign({ name: TEACHER.name, role: 'school_staff', dev: device.id }, process.env.JWT_SECRET,
    { subject: TEACHER.id, expiresIn: '10m', algorithm: 'HS256' });
  const res = await fetch(`${API}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ clientId: device.clientId, operations }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Sync refused (${res.status}): ${body.error || 'no message'}`);
  return body.results || [];
}

function outcome(result) {
  if (result.success) return 'saved';
  return result.status || result.error || 'not saved';
}

/**
 * School days up to today, newest first: weekdays inside a term, not a holiday or closure.
 * Each is { day, free } (free: the school has no feeding record for it yet).
 */
async function schoolDays(count) {
  return (await pool.query(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day,
            NOT EXISTS (SELECT 1 FROM daily_feeding f WHERE f.school_id = $1 AND f.feeding_date = d) AS free
     FROM generate_series((now() AT TIME ZONE $2)::date - 60, (now() AT TIME ZONE $2)::date, interval '1 day') AS d
     WHERE EXTRACT(ISODOW FROM d) < 6
       AND EXISTS (SELECT 1 FROM school_terms t WHERE d BETWEEN t.opens_on AND t.closes_on)
       AND NOT EXISTS (SELECT 1 FROM calendar_events e WHERE d BETWEEN e.starts_on AND e.ends_on
                       AND e.kind IN ('public_holiday', 'school_closure') AND (e.school_id IS NULL OR e.school_id = $1))
     ORDER BY d DESC LIMIT $3`,
    [SCHOOL, TIME_ZONE, count]
  )).rows;
}

async function enrolledOn(iso) {
  const r = await pool.query(
    `SELECT SUM(e.learners)::int AS n FROM enrolment e JOIN school_terms t ON t.id = e.term_id
     WHERE e.school_id = $1 AND $2::date BETWEEN t.opens_on AND t.closes_on`, [SCHOOL, iso]);
  return r.rows[0].n;
}


const day = (iso, fed, cereals, pulses, extra = {}) => ({
  schoolId: SCHOOL, feedingDate: display(iso), feedingHappened: true,
  learnersPresent: fed + 12, learnersFed: fed, cerealsKg: cereals, pulsesKg: pulses, ...extra,
});

async function setUp() {
  const school = (await pool.query('SELECT name, sub_county FROM schools WHERE id = $1', [SCHOOL])).rows[0];
  if (!school) throw new Error('This is not a demo database: Jaribio Primary School from database/seed.sql is missing');
  const done = (await pool.query('SELECT 1 FROM users WHERE id = $1', [TEACHER.id])).rowCount;
  if (done) throw new Error('The demonstration scenarios are already loaded.');
  const history = (await pool.query('SELECT count(*)::int AS n FROM daily_feeding WHERE school_id = $1', [SCHOOL])).rows[0].n;
  if (history === 0) throw new Error('Load the demo records first: sh deploy/load-demo-records.sh');

  // The teacher has no usable password: the scenarios sign their requests here
  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, role, school_id)
     VALUES ($1, $2, $3, $4, 'school_staff', $5)`,
    [TEACHER.id, TEACHER.name, TEACHER.email, `demo-only-${crypto.randomBytes(16).toString('hex')}`, SCHOOL]
  );
  for (const device of Object.values(DEVICES)) {
    await pool.query(
      `INSERT INTO devices (id, school_id, name, status, public_key, approved_at)
       VALUES ($1, $2, $3, 'approved', $4, NOW())`,
      [device.id, SCHOOL, device.name, PLACEHOLDER_KEY]
    );
  }
  return school;
}

async function recordScenarios() {
  // The four most recent school days (today first) are within the entry window and,
  // captured on the day, sync within the offline limit; older days are for the late and
  // kept-offline scenarios.
  const days = await schoolDays(12);
  const recent = days.slice(0, 4);
  if (recent.length < 4 || recent.some((d) => !d.free)) {
    throw new Error(`Jaribio Primary School already has records on ${recent.filter((d) => !d.free).map((d) => display(d.day)).join(', ') || 'none of the last four school days'}; the scenarios need its last four school days empty`);
  }
  const older = days.slice(4).filter((d) => d.free).map((d) => d.day);
  if (older.length < 2) throw new Error('Not enough earlier school days without a record');
  const [today, d1, d2, d3] = recent.map((d) => d.day);
  const [offlineDay, lateDay] = older;
  const { store, phone } = DEVICES;
  // Learners fed on an ordinary day: the school's usual number over its last 20 feeding
  // days, with food at the ration
  const enrolled = await enrolledOn(today);
  const usual = (await pool.query(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY learners_fed) AS fed
     FROM (SELECT learners_fed FROM daily_feeding WHERE school_id = $1 AND feeding_happened ORDER BY feeding_date DESC LIMIT 20) f`,
    [SCHOOL]
  )).rows[0].fed;
  const base = Math.round(Number(usual) || (enrolled || 450) * 0.85);
  const half = (kg) => Math.round(kg * 2) / 2;
  const meal = (iso, delta, extra) => { const fed = base + delta; return day(iso, fed, half(fed * 0.15), half(fed * 0.04), extra); };
  const report = [];
  const note = (what, results) => report.push(`  ${what}: ${results.map(outcome).join(', ')}`);
  // Entries made "today" are captured in school hours, so only the scenario's own flag shows
  const todayAt = (time) => (Date.now() > Date.parse(at(today, time)) ? at(today, time) : new Date(Date.now() - 60000).toISOString());

  // Food in the store first, so the days below are not all short of stock. The cereals
  // note is recorded on both devices: the second is held, not counted twice. The pulses
  // arrive lighter than their note.
  const deliveryOn = (commodity, kg, noteKg, reference) => ({
    id: crypto.randomUUID(), schoolId: SCHOOL, movementDate: display(d3), commodity, kind: 'delivery',
    quantityKg: kg, noteQuantityKg: noteKg, reference, witness: 'Mr Ochieng, school meals committee',
  });
  note('Delivery DN-JAR-0412 (1,000 kg cereals) on the tablet', await sync(store, [op('stockMovement', 'create', deliveryOn('cereals', 1000, 1000, 'DN-JAR-0412'), 0, store, at(d2, '07:00'))]));
  note('Delivery DN-JAR-0412 again on the phone', await sync(phone, [op('stockMovement', 'create', deliveryOn('cereals', 1000, 1000, 'DN-JAR-0412'), 0, phone, at(d2, '07:20'))]));
  note('Pulses delivery DN-JAR-0413, 280 kg against 300 kg on the note', await sync(store, [op('stockMovement', 'create', deliveryOn('pulses', 280, 300, 'DN-JAR-0413'), 0, store, at(d2, '07:05'))]));

  // Conflict 1: the same day recorded on both devices, with different numbers
  note(`${display(d2)} recorded on the store tablet`, await sync(store, [op('dailyFeeding', 'create', meal(d2, 6), 0, store, at(d2, '13:10'))]));
  note(`${display(d2)} recorded again on the head teacher's phone (different numbers)`,
    await sync(phone, [op('dailyFeeding', 'create', meal(d2, -8), 0, phone, at(d2, '13:40'))]));

  // Conflict 2: the same day edited on both devices from the same version
  note(`${display(d3)} recorded`, await sync(store, [op('dailyFeeding', 'create', meal(d3, 0), 0, store, at(d2, '07:30'))]));
  note(`${display(d3)} corrected on the phone`, await sync(phone, [op('dailyFeeding', 'update', meal(d3, 4), 1, phone, at(d2, '09:00'))]));
  note(`${display(d3)} corrected on the tablet from the old version`,
    await sync(store, [op('dailyFeeding', 'update', meal(d3, 16), 1, store, at(d2, '09:10'))]));

  // Captured at night
  note(`${display(d1)} captured at 21:40`, await sync(store, [op('dailyFeeding', 'create', meal(d1, -3), 0, store, at(d1, '21:40'))]));

  // Kept on the phone for days before it synced: a day without feeding
  note(`${display(offlineDay)} (not fed: the cook was absent) kept offline on the phone since that day`,
    await sync(phone, [op('dailyFeeding', 'create', {
      schoolId: SCHOOL, feedingDate: display(offlineDay), feedingHappened: false, learnersPresent: 380,
      learnersFed: 0, cerealsKg: 0, pulsesKg: 0, reasonCode: 'cook_absent',
    }, 0, phone, at(offlineDay, '13:20'))]));

  // Entered late from paper, with half the cereals ration issued
  note(`${display(lateDay)} entered today from paper: half the cereals ration for ${base} learners`,
    await sync(store, [op('dailyFeeding', 'create',
      day(lateDay, base, half(base * 0.075), half(base * 0.04), { lateReason: 'Copied from the paper register after the tablet was repaired' }),
      0, store, todayAt('10:00'))]));

  // More learners fed than enrolled, with a reason
  if (enrolled) {
    const fed = enrolled + Math.max(5, Math.round(enrolled * 0.04));
    note(`${display(today)} with ${fed} fed against ${enrolled} enrolled`, await sync(store, [op('dailyFeeding', 'create',
      day(today, fed, Math.round(fed * 0.15 * 2) / 2, Math.round(fed * 0.04 * 2) / 2,
        { learnersPresent: fed + 3, reasonCode: 'other', note: 'Two families moved here after the drought; admission forms with the head teacher' }),
      0, store, todayAt('13:30'))]));
  }
  return report;
}

/**
 * The practice term (database/demo/practice_term.sql) starts after the demo records end, so
 * without this the officer's term figures would show almost no school days recorded. Every
 * school in the sub-county gets ordinary days up to yesterday, like its last 20 days of
 * Term 3: learners fed within a few per cent of its usual number, food at its usual rate,
 * captured at lunchtime and synced the same afternoon. Each school also receives (in kind)
 * or buys (cash transfer) the term's food on opening day, so its store does not run dry.
 * Jaribio's last 12 school days stay empty for the scenarios.
 */
async function fillPracticeTerm(subCounty) {
  const term = (await pool.query(
    "SELECT id, to_char(opens_on, 'YYYY-MM-DD') AS opens, to_char(closes_on, 'YYYY-MM-DD') AS closes FROM school_terms WHERE practice ORDER BY opens_on DESC LIMIT 1"
  )).rows[0];
  if (!term) return ['  No practice term in the calendar; nothing added'];
  const days = (await pool.query(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day
     FROM generate_series($1::date, LEAST($2::date, (now() AT TIME ZONE $3)::date - 1), interval '1 day') AS d
     WHERE EXTRACT(ISODOW FROM d) < 6
       AND NOT EXISTS (SELECT 1 FROM calendar_events e WHERE d BETWEEN e.starts_on AND e.ends_on
                       AND e.kind IN ('public_holiday', 'school_closure') AND e.school_id IS NULL)
     ORDER BY d`,
    [term.opens, term.closes, TIME_ZONE]
  )).rows.map((r) => r.day);
  const termDays = (await pool.query(
    `SELECT count(*)::int AS n FROM generate_series($1::date, $2::date, interval '1 day') AS d WHERE EXTRACT(ISODOW FROM d) < 6`,
    [term.opens, term.closes]
  )).rows[0].n;
  const schools = (await pool.query(
    `SELECT s.id, s.name, s.programme_type,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY f.learners_fed) AS fed,
            SUM(f.cereals_kg) / NULLIF(SUM(f.learners_fed), 0) AS cereals_per_learner,
            SUM(f.pulses_kg) / NULLIF(SUM(f.learners_fed), 0) AS pulses_per_learner
     FROM schools s
     JOIN LATERAL (SELECT * FROM daily_feeding f WHERE f.school_id = s.id AND f.feeding_happened AND f.feeding_date < $2
                   ORDER BY f.feeding_date DESC LIMIT 20) f ON true
     WHERE s.sub_county = $1
     GROUP BY s.id ORDER BY s.name`,
    [subCounty, term.opens]
  )).rows;
  const half = (kg) => Math.round(kg * 2) / 2;
  // The same small, repeatable variation every time the demo is built
  const wobble = (text) => (crypto.createHash('md5').update(text).digest()[0] / 255 - 0.5) * 0.08;
  let rows = 0;
  for (const s of schools) {
    const usual = Number(s.fed);
    const cpl = Number(s.cereals_per_learner) || 0.15;
    const ppl = Number(s.pulses_per_learner) || 0.04;
    const own = s.id === SCHOOL ? days.slice(0, Math.max(0, days.length - 12)) : days;
    for (const day of own) {
      const fed = Math.round(usual * (1 + wobble(`${s.id}${day}`)));
      await pool.query(
        `INSERT INTO daily_feeding (school_id, feeding_date, feeding_happened, learners_present, learners_fed, cereals_kg, pulses_kg,
                                    captured_at, received_at)
         VALUES ($1, $2, true, $3, $4, $5, $6, ($2::date + time '13:00') AT TIME ZONE '${TIME_ZONE}', ($2::date + time '16:00') AT TIME ZONE '${TIME_ZONE}')
         ON CONFLICT (school_id, feeding_date) DO NOTHING`,
        [s.id, day, fed + Math.round(fed * 0.03), fed, half(fed * cpl), half(fed * ppl)]
      );
      rows += 1;
    }
    // The term's food, received on opening day
    const kind = s.programme_type === 'in_kind' ? 'delivery' : 'purchase';
    for (const [commodity, perLearner] of [['cereals', cpl], ['pulses', ppl]]) {
      const kg = Math.ceil((usual * perLearner * termDays * 1.05) / 50) * 50;
      await pool.query(
        `INSERT INTO stock_movements (id, school_id, movement_date, commodity, kind, quantity_kg, note_quantity_kg, reference)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`,
        [crypto.randomUUID(), s.id, term.opens, commodity, kind, kg, kind === 'delivery' ? `DN-PT-${commodity.slice(0, 1).toUpperCase()}-${s.name.slice(0, 3).toUpperCase()}` : `RECEIPT-PT-${s.name.slice(0, 3).toUpperCase()}`]
      );
    }
  }
  return [`  ${rows} ordinary school days added to the practice term across ${schools.length} schools, and each school's term food on opening day`];
}

/** Score Term 3 2026's weeks that have no ranking yet, as the weekly schedule would. */
async function scoreTerm(subCounty) {
  const term = (await pool.query(
    "SELECT to_char(opens_on, 'YYYY-MM-DD') AS opens, to_char(closes_on, 'YYYY-MM-DD') AS closes FROM school_terms WHERE year = 2026 AND term = 3"
  )).rows[0];
  if (!term) return ['  Term 3 2026 is not in the calendar; nothing scored'];
  const weeks = (await pool.query(
    `SELECT to_char(w, 'YYYY-MM-DD') AS week FROM generate_series(date_trunc('week', $1::date), $2::date, interval '7 days') AS w
     WHERE NOT EXISTS (SELECT 1 FROM review_runs r WHERE r.sub_county = $3 AND r.week_start = w::date)`,
    [term.opens, term.closes, subCounty]
  )).rows.map((r) => r.week);
  const lines = [];
  for (const week of weeks) {
    try {
      await scoreWeek({ subCounty, weekStart: week, k: 3, bySchedule: true });
    } catch (error) {
      lines.push(`  ${display(week)}: not scored (${error.message})`);
    }
  }
  const listed = (await pool.query(
    `SELECT to_char(r.week_start, 'YYYY-MM-DD') AS week, s.name, i.explanation
     FROM review_runs r JOIN review_items i ON i.run_id = r.id AND i.listed JOIN schools s ON s.id = i.school_id
     WHERE r.sub_county = $1 AND r.week_start BETWEEN date_trunc('week', $2::date) AND $3::date
     ORDER BY r.week_start, i.rank`,
    [subCounty, term.opens, term.closes]
  )).rows;
  for (const row of listed) lines.push(`  Week of ${display(row.week)} · ${row.name}: ${row.explanation.replace(/^Needs review:\s*/, '')}`);
  return lines;
}

async function main() {
  const school = await setUp();
  console.log('Practice term:');
  for (const line of await fillPracticeTerm(school.sub_county)) console.log(line);
  console.log(`Scenarios at ${school.name}, as ${TEACHER.name} on "${DEVICES.store.name}" and "${DEVICES.phone.name}":`);
  for (const line of await recordScenarios()) console.log(line);
  console.log(`\nTerm 3 2026 weekly review for ${school.sub_county} (weeks scored now, and listed schools):`);
  for (const line of await scoreTerm(school.sub_county)) console.log(line);
}

main()
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => pool.end());
