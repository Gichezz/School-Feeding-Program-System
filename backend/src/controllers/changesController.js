const { pool } = require('../db/pool');
const { isUuid } = require('../validation/records');
const { isoDate } = require('../services/integrity');
const { visibleSchool } = require('../services/schoolAccess');

/**
 * Downloading changes to a school device (the pull half of sync).
 *
 * Devices send their own records with POST /api/sync and download everyone else's
 * here, so every device at a school ends up with the same enrolment, feeding records
 * and stock ledger, and can work out the stock balance and days of food left offline.
 *
 * The cursor is a transaction id, not a counter. Each synced row is stamped with the
 * transaction that wrote it (change_xid). A download returns rows written by
 * transactions that had finished before the oldest transaction still running
 * (the snapshot's xmin), and that xmin becomes the next cursor. A save still in
 * progress has an id at or above it, so it is picked up next time; a plain counter
 * could be overtaken by a later save that commits first, and that row would be missed.
 *
 * Nothing in these tables is deleted (ledger entries are reversed, feeding records
 * and enrolment are edited), so a download never has to report removals.
 */

function displayDate(value) {
  if (value === null || value === undefined) return null;
  const [year, month, day] = isoDate(value).split('-');
  return `${day}-${month}-${year}`;
}

const kg = (value) => (value === null ? null : Number(value));

const SHAPES = {
  enrolment: (r) => ({
    serverId: r.id, schoolId: r.school_id, termId: r.term_id, class: r.class, sex: r.sex,
    learners: r.learners, verified: r.verified_at !== null, version: r.version,
  }),
  dailyFeeding: (r) => ({
    serverId: r.id, schoolId: r.school_id, feedingDate: displayDate(r.feeding_date),
    feedingHappened: r.feeding_happened, learnersPresent: r.learners_present, learnersFed: r.learners_fed,
    cerealsKg: kg(r.cereals_kg), pulsesKg: kg(r.pulses_kg), reasonCode: r.reason_code, note: r.note,
    capturedBy: r.captured_by, version: r.version,
  }),
  stockMovements: (r) => ({
    id: r.id, schoolId: r.school_id, movementDate: displayDate(r.movement_date), commodity: r.commodity,
    kind: r.kind, quantityKg: kg(r.quantity_kg), noteQuantityKg: kg(r.note_quantity_kg), reference: r.reference,
    supplier: r.supplier, note: r.note, reversesId: r.reverses_id, capturedBy: r.captured_by,
  }),
  stockCounts: (r) => ({
    id: r.id, schoolId: r.school_id, countDate: displayDate(r.count_date), commodity: r.commodity,
    countedKg: kg(r.counted_kg), note: r.note, capturedBy: r.captured_by,
  }),
};

const TABLES = {
  enrolment: 'enrolment',
  dailyFeeding: 'daily_feeding',
  stockMovements: 'stock_movements',
  stockCounts: 'stock_counts',
};

function schoolSettings(s) {
  return {
    id: s.id,
    name: s.name,
    county: s.county,
    subCounty: s.sub_county,
    programmeType: s.programme_type,
    // grams per learner per day
    ration: {
      cereals: Number(s.ration_cereals_g), pulses: Number(s.ration_pulses_g),
      oil: Number(s.ration_oil_g), salt: Number(s.ration_salt_g),
    },
  };
}

/**
 * GET /api/sync/changes?schoolId=&since=
 * → { cursor, school, terms, calendarEvents, enrolment, dailyFeeding, stockMovements, stockCounts }
 * since: the cursor from the previous download, or 0 (or nothing) for everything.
 */
async function getChanges(req, res, next) {
  const schoolId = req.query.schoolId || req.user.schoolId;
  const since = req.query.since === undefined ? '0' : String(req.query.since);
  if (!isUuid(schoolId)) return res.status(400).json({ error: 'schoolId is required' });
  if (!/^\d{1,20}$/.test(since)) return res.status(400).json({ error: 'since must be a cursor from a previous download' });

  const client = await pool.connect();
  try {
    // One snapshot for every query, so the cursor matches what was read
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const school = await visibleSchool(client, req.user, schoolId);
    if (!school) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'School not found' });
    }
    const cursor = (await client.query('SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS xmin')).rows[0].xmin;

    const changes = {};
    for (const [name, table] of Object.entries(TABLES)) {
      const rows = (await client.query(
        `SELECT * FROM ${table}
         WHERE school_id = $1 AND change_xid >= $2::xid8 AND change_xid < $3::xid8
         ORDER BY change_xid`,
        [schoolId, since, cursor]
      )).rows;
      changes[name] = rows.map(SHAPES[name]);
    }

    // Reference data is small and always sent whole
    const terms = (await client.query('SELECT * FROM school_terms ORDER BY opens_on')).rows.map((t) => ({
      id: t.id, year: t.year, term: t.term, opensOn: displayDate(t.opens_on), closesOn: displayDate(t.closes_on),
      halfTermStart: displayDate(t.half_term_start), halfTermEnd: displayDate(t.half_term_end),
    }));
    const calendarEvents = (await client.query(
      'SELECT * FROM calendar_events WHERE school_id IS NULL OR school_id = $1 ORDER BY starts_on',
      [schoolId]
    )).rows.map((e) => ({
      id: e.id, startsOn: displayDate(e.starts_on), endsOn: displayDate(e.ends_on), kind: e.kind, name: e.name,
    }));

    await client.query('COMMIT');
    res.json({ cursor, school: schoolSettings(school), terms, calendarEvents, ...changes });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

module.exports = { getChanges };
