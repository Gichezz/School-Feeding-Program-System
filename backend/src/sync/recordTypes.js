const {
  enrolmentError, feedingError, movementError, countError,
} = require('../validation/records');
const { isoDate: storedDate } = require('../services/integrity');

/**
 * The records school devices sync, beyond the original attendance and meal records.
 * Each type says how to validate it, find the server copy, create it and edit it.
 *
 *   versioned    enrolment and the daily feeding record: one record per natural key
 *                (school, term, class and sex; school and date), edited with optimistic
 *                concurrency. A create for a key that already exists is the same record
 *                when the values match and a conflict when they differ; an edit based on
 *                an older version, or on another server record, is a conflict.
 *   append-only  stock ledger entries and stock counts: identified by an id made on the
 *                device, never edited, so they never conflict. A replay of the same entry
 *                is recognised; a mistake is corrected with a reversing entry.
 *
 * Integrity metadata (who captured it, on which device, when, when it arrived and in
 * which sync batch) is written by the same statement that saves the record.
 */

/** DD-MM-YYYY → YYYY-MM-DD */
function isoDate(display) {
  const [day, month, year] = display.split('-');
  return `${year}-${month}-${day}`;
}

function nullable(value) {
  return value === undefined ? null : value;
}

function basedOnCurrent(record, baseVersion, baseRecordId) {
  return record.version === baseVersion && (!baseRecordId || baseRecordId === record.id);
}

function sameValues(row, values) {
  return Object.entries(values).every(([column, value]) => {
    const stored = row[column];
    if (value === null || stored === null) return value === stored;
    // DATE columns come back as Date objects; compare them as YYYY-MM-DD
    if (stored instanceof Date) return storedDate(stored) === value;
    return typeof value === 'number' ? Number(stored) === value : stored === value;
  });
}

function sameKeyConflict(what) {
  return new Error(`Same-record conflict: ${what} was already synced with different values`);
}

function staleEdit(baseVersion, row) {
  return new Error(`Version mismatch: base version ${baseVersion}, server version ${row.version}`);
}

/**
 * Create or edit a versioned record. `values` are the columns the device sets.
 */
function versioned({ table, keyColumns, keyOf, valuesOf, what, onChange = '', lateReason = true }) {
  const columns = { editable: true, lateReason };
  async function find(client, payload) {
    const key = keyOf(payload);
    const where = keyColumns.map((c, i) => `${c} = $${i + 1}`).join(' AND ');
    return (await client.query(`SELECT * FROM ${table} WHERE ${where}`, keyColumns.map((c) => key[c]))).rows[0] || null;
  }

  async function create(client, payload, ctx) {
    const values = valuesOf(payload);
    const existing = await find(client, payload);
    if (existing) {
      if (sameValues(existing, values)) return { recordId: existing.id, version: existing.version, duplicate: true };
      throw sameKeyConflict(what);
    }
    const row = { ...keyOf(payload), ...values, ...metadata(ctx, payload, columns) };
    const names = Object.keys(row);
    const result = await client.query(
      `INSERT INTO ${table} (${names.join(', ')}, version)
       VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}, 1)
       RETURNING id, version`,
      names.map((c) => row[c])
    );
    return { recordId: result.rows[0].id, version: result.rows[0].version };
  }

  async function update(client, payload, baseVersion, baseRecordId, ctx) {
    const current = await find(client, payload);
    if (!current) throw new Error('Record not found');
    const values = valuesOf(payload);
    if (!basedOnCurrent(current, baseVersion, baseRecordId)) {
      // Based on an older version, but the server already has these values
      if (sameValues(current, values)) return { recordId: current.id, version: current.version, duplicate: true };
      throw staleEdit(baseVersion, current);
    }
    const row = { ...values, ...metadata(ctx, payload, columns) };
    const names = Object.keys(row);
    const result = await client.query(
      `UPDATE ${table}
       SET ${names.map((c, i) => `${c} = $${i + 1}`).join(', ')},
           version = version + 1, updated_at = NOW() ${onChange}
       WHERE id = $${names.length + 1}
       RETURNING id, version`,
      [...names.map((c) => row[c]), current.id]
    );
    return { recordId: result.rows[0].id, version: result.rows[0].version };
  }

  return { versioned: true, table, find, create, update };
}

/**
 * Create an append-only entry; a replay of the same entry is recognised.
 */
function appendOnly({ table, rowOf, check = async () => {} }) {
  async function find(client, payload) {
    return (await client.query(`SELECT * FROM ${table} WHERE id = $1`, [payload.id])).rows[0] || null;
  }

  async function create(client, payload, ctx) {
    const values = rowOf(payload);
    const existing = await find(client, payload);
    if (existing) {
      if (sameValues(existing, values)) return { recordId: existing.id, version: 1, duplicate: true };
      throw new Error('This entry id is already used by a different entry');
    }
    await check(client, payload);
    const row = { id: payload.id, ...values, ...metadata(ctx, payload, { editable: false, lateReason: true }) };
    const columns = Object.keys(row);
    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
      columns.map((c) => row[c])
    );
    return { recordId: payload.id, version: 1 };
  }

  async function update() {
    throw new Error('Stock entries cannot be edited: record a reversing entry instead');
  }

  return { appendOnly: true, table, find, create, update };
}

/**
 * Integrity metadata columns. Editable records also say who last changed them; records
 * for a date also keep the reason for a late entry.
 */
function metadata(ctx, payload, { editable, lateReason }) {
  return {
    captured_by: ctx.capture.capturedBy,
    device_id: ctx.capture.deviceId,
    captured_at: ctx.capture.capturedAt,
    received_at: ctx.now,
    sync_batch_id: ctx.batchId,
    client_id: ctx.clientId,
    ...(editable ? { updated_by: ctx.userId } : {}),
    ...(lateReason ? { late_reason: nullable(payload.lateReason) } : {}),
  };
}

const enrolment = {
  dbType: 'enrolment',
  validate: (p) => enrolmentError({ schoolId: p.schoolId, termId: p.termId, schoolClass: p.class, sex: p.sex, learners: p.learners }),
  date: () => null,
  ...versioned({
    table: 'enrolment',
    keyColumns: ['school_id', 'term_id', 'class', 'sex'],
    keyOf: (p) => ({ school_id: p.schoolId, term_id: p.termId, class: p.class, sex: p.sex }),
    valuesOf: (p) => ({ learners: p.learners }),
    what: 'enrolment for this class and term',
    // A changed count needs verifying again
    onChange: ', verified_by = NULL, verified_at = NULL',
    // Enrolment is for a term, not a date, so there is no late entry to explain
    lateReason: false,
  }),
  history: (row) => ({ term: row.term_id, class: row.class, sex: row.sex, learners: row.learners }),
};
const dailyFeeding = {
  dbType: 'daily_feeding',
  validate: (p) => feedingError({
    schoolId: p.schoolId, date: p.feedingDate, happened: p.feedingHappened, present: p.learnersPresent,
    fed: p.learnersFed, cerealsKg: p.cerealsKg, pulsesKg: p.pulsesKg, reasonCode: p.reasonCode, note: p.note,
  }),
  date: (p) => p.feedingDate,
  ...versioned({
    table: 'daily_feeding',
    keyColumns: ['school_id', 'feeding_date'],
    keyOf: (p) => ({ school_id: p.schoolId, feeding_date: isoDate(p.feedingDate) }),
    valuesOf: (p) => ({
      feeding_happened: p.feedingHappened,
      learners_present: nullable(p.learnersPresent),
      learners_fed: p.learnersFed,
      cereals_kg: p.cerealsKg,
      pulses_kg: p.pulsesKg,
      reason_code: nullable(p.reasonCode),
      note: nullable(p.note),
    }),
    what: 'the feeding record for this date',
  }),
  history: (row) => ({
    happened: row.feeding_happened, present: row.learners_present, fed: row.learners_fed,
    cerealsKg: Number(row.cereals_kg), pulsesKg: Number(row.pulses_kg), reason: row.reason_code,
  }),
};

const stockMovement = {
  dbType: 'stock_movement',
  validate: (p) => movementError({
    id: p.id, schoolId: p.schoolId, date: p.movementDate, commodity: p.commodity, kind: p.kind,
    quantityKg: p.quantityKg, noteQuantityKg: p.noteQuantityKg, reference: p.reference, note: p.note, reversesId: p.reversesId,
  }),
  date: (p) => p.movementDate,
  ...appendOnly({
    table: 'stock_movements',
    rowOf: (p) => ({
      school_id: p.schoolId,
      movement_date: isoDate(p.movementDate),
      commodity: p.commodity,
      kind: p.kind,
      quantity_kg: p.quantityKg,
      note_quantity_kg: nullable(p.noteQuantityKg),
      reference: nullable(p.reference),
      supplier: nullable(p.supplier),
      note: nullable(p.note),
      reverses_id: nullable(p.reversesId),
    }),
    // A reversal cancels one entry of the same school, commodity and quantity
    check: async (client, p) => {
      if (p.kind !== 'reversal') return;
      const target = (await client.query('SELECT * FROM stock_movements WHERE id = $1', [p.reversesId])).rows[0];
      if (!target || target.school_id !== p.schoolId) throw new Error('The entry to reverse was not found');
      if (target.kind === 'reversal') throw new Error('A reversal cannot itself be reversed');
      if (target.commodity !== p.commodity || Number(target.quantity_kg) !== p.quantityKg) {
        throw new Error('A reversal must have the same commodity and quantity as the entry it cancels');
      }
    },
  }),
};

const stockCount = {
  dbType: 'stock_count',
  validate: (p) => countError({ id: p.id, schoolId: p.schoolId, date: p.countDate, commodity: p.commodity, countedKg: p.countedKg }),
  date: (p) => p.countDate,
  ...appendOnly({
    table: 'stock_counts',
    rowOf: (p) => ({
      school_id: p.schoolId,
      count_date: isoDate(p.countDate),
      commodity: p.commodity,
      counted_kg: p.countedKg,
      note: nullable(p.note),
    }),
  }),
};

const RECORD_TYPES = { enrolment, dailyFeeding, stockMovement, stockCount };

module.exports = { RECORD_TYPES, basedOnCurrent, isoDate };
