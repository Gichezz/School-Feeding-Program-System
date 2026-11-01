const { addFlag, isoDate, timingFlags } = require('./integrity');

/**
 * After a feeding, enrolment or stock record is synced: keep the saved version in
 * record_history (records that can be edited), and raise rule-based flags for a
 * programme officer to review. Like the attendance and meal checks, flags never block
 * a record; they make an unusual entry visible.
 */

const DATE_COLUMNS = {
  enrolment: null,
  daily_feeding: 'feeding_date',
  stock_movement: 'movement_date',
  stock_count: 'count_date',
};

// Food issued may differ from the ration for learners fed by this share before it is flagged
const USAGE_TOLERANCE = 0.3;
// Food issued is recorded to the nearest 0.5 kg: a difference within half of that is
// rounding, whatever the school's size (the same rule as the review list's features)
const RECORDING_PRECISION_KG = 0.25;
// A delivery may be this much lighter than its note (weighing, spillage) before it is flagged
const DELIVERY_TOLERANCE = 0.02;

function kg(value) {
  return `${Number(value).toLocaleString('en-GB', { maximumFractionDigits: 2 })} kg`;
}

/** Stock of one commodity at the end of a date: everything in, minus everything out. */
async function balanceAt(client, schoolId, commodity, date) {
  const result = await client.query(
    `SELECT COALESCE(SUM(quantity_kg), 0) AS balance FROM stock_flows
     WHERE school_id = $1 AND commodity = $2 AND flow_date <= $3`,
    [schoolId, commodity, date]
  );
  return Number(result.rows[0].balance);
}

/** Learners enrolled at the school in the term that contains the date, or null. */
async function enrolledOn(client, schoolId, date) {
  const result = await client.query(
    `SELECT SUM(e.learners) AS learners FROM enrolment e
     JOIN school_terms t ON t.id = e.term_id
     WHERE e.school_id = $1 AND $2::date BETWEEN t.opens_on AND t.closes_on`,
    [schoolId, date]
  );
  const learners = result.rows[0].learners;
  return learners === null ? null : Number(learners);
}

async function feedingFlags(client, row) {
  if (!row.feeding_happened) return;
  const enrolled = await enrolledOn(client, row.school_id, row.feeding_date);
  if (enrolled !== null && row.learners_fed > enrolled) {
    await addFlag(client, 'daily_feeding', row, 'fed_exceeds_enrolled',
      `${row.learners_fed} learners fed but ${enrolled} enrolled this term`);
  }

  const school = (await client.query(
    'SELECT ration_cereals_g, ration_pulses_g FROM schools WHERE id = $1', [row.school_id]
  )).rows[0];
  if (row.learners_fed > 0 && school) {
    const parts = [];
    for (const [commodity, issued, grams] of [
      ['cereals', row.cereals_kg, school.ration_cereals_g],
      ['pulses', row.pulses_kg, school.ration_pulses_g],
    ]) {
      const expected = (row.learners_fed * Number(grams)) / 1000;
      const beyondRounding = Math.max(Math.abs(Number(issued) - expected) - RECORDING_PRECISION_KG, 0);
      if (beyondRounding / expected > USAGE_TOLERANCE) {
        parts.push(`${kg(issued)} of ${commodity} for ${row.learners_fed} learners fed; the ration is ${kg(expected)}`);
      }
    }
    if (parts.length) await addFlag(client, 'daily_feeding', row, 'usage_far_from_ration', parts.join('. '));
  }

  const short = [];
  for (const [commodity, issued] of [['cereals', row.cereals_kg], ['pulses', row.pulses_kg]]) {
    if (Number(issued) === 0) continue;
    const balance = await balanceAt(client, row.school_id, commodity, row.feeding_date);
    if (balance < 0) short.push(`${commodity}: ${kg(-balance)} more issued than the store held`);
  }
  if (short.length) await addFlag(client, 'daily_feeding', row, 'issue_exceeds_stock', short.join('. '));
}

async function movementFlags(client, row) {
  const received = Number(row.quantity_kg);
  if ((row.kind === 'delivery' || row.kind === 'purchase') && row.note_quantity_kg !== null) {
    const onNote = Number(row.note_quantity_kg);
    if (received < onNote * (1 - DELIVERY_TOLERANCE)) {
      await addFlag(client, 'stock_movement', row, 'delivery_short',
        `${kg(received)} of ${row.commodity} received; ${row.reference} says ${kg(onNote)}`);
    }
  }
  if (row.kind === 'loss' || row.kind === 'return') {
    const balance = await balanceAt(client, row.school_id, row.commodity, row.movement_date);
    if (balance < 0) {
      await addFlag(client, 'stock_movement', row, 'issue_exceeds_stock',
        `${row.commodity}: ${kg(-balance)} more removed than the store held`);
    }
  }
}

/**
 * Call after a record type from sync/recordTypes.js is created or edited.
 * flag: false for an administrator's own decision (applying a held record, resolving a conflict)
 */
async function afterSyncedRecord(client, { recordType, recordId, capture = {}, late = false, flag = true }) {
  const row = (await client.query(`SELECT * FROM ${recordType.table} WHERE id = $1`, [recordId])).rows[0];
  if (!row) return;
  const entityType = recordType.dbType;
  // Append-only entries have no version: each one is the only version
  const flagRow = { ...row, version: row.version || 1 };

  if (recordType.versioned) {
    await client.query(
      `INSERT INTO record_history (entity_type, record_id, version, values, changed_by, device_id, captured_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [entityType, row.id, row.version, JSON.stringify(recordType.history(row)),
        row.updated_by || capture.capturedBy || null, row.device_id, row.captured_at]
    );
  }
  if (!flag) return;

  await timingFlags(client, entityType, flagRow, { late, dateColumn: DATE_COLUMNS[entityType] });
  if (entityType === 'daily_feeding') await feedingFlags(client, flagRow);
  if (entityType === 'stock_movement') await movementFlags(client, flagRow);
}

module.exports = { afterSyncedRecord, balanceAt, enrolledOn, isoDate };
