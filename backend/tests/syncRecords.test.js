const app = require('../src/app');
const { api } = require('./helpers/auth');
const { pool, resetDatabase, SCHOOL_ID, syncOperation } = require('./helpers/fixtures');

const asAdmin = api(app);
const asStaff = api(app, 'staff');
const asOfficer = api(app, 'officer');

const OTHER_SCHOOL_ID = '11111111-1111-1111-1111-111111111112';
const BATCH_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

let termId;

beforeEach(async () => {
  await resetDatabase();
  // The test clock is Thursday 8 October 2026: Term 3 of 2026
  termId = (await pool.query('SELECT id FROM school_terms WHERE year = 2026 AND term = 3')).rows[0].id;
});
afterAll(() => pool.end());

function sync(operations, { as = asAdmin, clientId = 'device-a', syncBatchId } = {}) {
  return as.post('/api/sync').send({ clientId, operations, ...(syncBatchId && { syncBatchId }) });
}

function feeding(overrides = {}) {
  return {
    schoolId: SCHOOL_ID,
    feedingDate: '06-10-2026',
    feedingHappened: true,
    learnersPresent: 410,
    learnersFed: 400,
    cerealsKg: 60,
    pulsesKg: 16,
    ...overrides,
  };
}

let entryCount = 0;
function entryId() {
  entryCount += 1;
  return `eeeeeeee-eeee-4eee-8eee-${String(entryCount).padStart(12, '0')}`;
}

function delivery(overrides = {}) {
  return {
    id: entryId(),
    schoolId: SCHOOL_ID,
    movementDate: '05-10-2026',
    commodity: 'cereals',
    kind: 'delivery',
    quantityKg: 500,
    reference: 'DN-2026-114',
    ...overrides,
  };
}

function enrolment(overrides = {}) {
  return { schoolId: SCHOOL_ID, termId, class: 'Grade 4', sex: 'F', learners: 52, ...overrides };
}

async function flagsFor(entityType) {
  return (await pool.query('SELECT flag, detail FROM record_flags WHERE entity_type = $1 ORDER BY flag', [entityType])).rows;
}

describe('daily feeding records', () => {
  it('saves a day with who captured it, its sync batch, a change number and its history', async () => {
    const res = await sync([syncOperation('op-1', 'dailyFeeding', 'create', feeding(), 0)], { syncBatchId: BATCH_ID });

    expect(res.body).toMatchObject({ syncBatchId: BATCH_ID, results: [{ status: 'synced', version: 1 }] });
    const row = (await pool.query('SELECT * FROM daily_feeding')).rows[0];
    expect(row).toMatchObject({ learners_fed: 400, sync_batch_id: BATCH_ID, captured_by: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' });
    expect(row.change_xid).not.toBeNull();
    expect(row.received_at).not.toBeNull();
    const batch = (await pool.query('SELECT operation_count FROM sync_batches WHERE id = $1', [BATCH_ID])).rows[0];
    expect(batch.operation_count).toBe(1);
    const history = (await pool.query("SELECT values FROM record_history WHERE entity_type = 'daily_feeding'")).rows;
    expect(history).toEqual([{ values: expect.objectContaining({ fed: 400, cerealsKg: 60 }) }]);
  });

  it('treats a replayed operation as already applied', async () => {
    await sync([syncOperation('op-1', 'dailyFeeding', 'create', feeding(), 0)]);

    const res = await sync([syncOperation('op-1', 'dailyFeeding', 'create', feeding(), 0)]);

    expect(res.body.results[0]).toMatchObject({ status: 'synced', version: 1 });
    expect((await pool.query('SELECT count(*)::int AS n FROM daily_feeding')).rows[0].n).toBe(1);
  });

  it('treats the same day from another device as the same record when the numbers match, and a conflict when they differ', async () => {
    await sync([syncOperation('op-1', 'dailyFeeding', 'create', feeding(), 0)]);

    const same = await sync([syncOperation('op-2', 'dailyFeeding', 'create', feeding(), 0)], { clientId: 'device-b' });
    const different = await sync([syncOperation('op-3', 'dailyFeeding', 'create', feeding({ learnersFed: 380 }), 0)], { clientId: 'device-c' });

    expect(same.body.results[0]).toMatchObject({ status: 'synced', version: 1 });
    expect(different.body.results[0]).toMatchObject({ status: 'conflict' });
    const conflict = (await pool.query('SELECT entity_type, status FROM conflicts')).rows;
    expect(conflict).toEqual([{ entity_type: 'daily_feeding', status: 'unresolved' }]);
  });

  it('applies an edit based on the current version and refuses a stale one', async () => {
    const created = await sync([syncOperation('op-1', 'dailyFeeding', 'create', feeding(), 0)]);
    const recordId = created.body.results[0].recordId;

    const edit = await sync([{ ...syncOperation('op-2', 'dailyFeeding', 'update', feeding({ learnersFed: 395, cerealsKg: 59.25 }), 1), baseRecordId: recordId }]);
    const stale = await sync([syncOperation('op-3', 'dailyFeeding', 'update', feeding({ learnersFed: 390 }), 1)], { clientId: 'device-b' });

    expect(edit.body.results[0]).toMatchObject({ status: 'synced', version: 2 });
    expect(stale.body.results[0]).toMatchObject({ status: 'conflict' });
    const row = (await pool.query('SELECT learners_fed, cereals_kg, version FROM daily_feeding')).rows[0];
    expect(row).toEqual({ learners_fed: 395, cereals_kg: '59.25', version: 2 });
  });

  it('accepts a day without feeding when it has a reason, and refuses one without', async () => {
    const notFed = { feedingHappened: false, learnersPresent: 380, learnersFed: 0, cerealsKg: 0, pulsesKg: 0 };

    const withReason = await sync([syncOperation('op-1', 'dailyFeeding', 'create', feeding({ ...notFed, reasonCode: 'no_food' }), 0)]);
    const withoutReason = await sync([syncOperation('op-2', 'dailyFeeding', 'create', feeding({ ...notFed, feedingDate: '07-10-2026' }), 0)]);

    expect(withReason.body.results[0]).toMatchObject({ status: 'synced' });
    expect(withoutReason.status).toBe(400);
    expect(withoutReason.body.error).toMatch(/reason feeding did not happen/);
  });

  it.each([
    ['more fed than present', { learnersFed: 420 }, /cannot exceed learners present/],
    ['a not-fed reason on a day with feeding', { reasonCode: 'no_food' }, /did not happen/],
    ['"other" without a note', { reasonCode: 'other' }, /Describe the reason/],
    ['kilograms to three decimals', { cerealsKg: 60.125 }, /2 decimal places/],
  ])('refuses %s', async (_, overrides, message) => {
    const res = await sync([syncOperation('op-1', 'dailyFeeding', 'create', feeding(overrides), 0)]);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it('flags more learners fed than enrolled this term', async () => {
    await sync([syncOperation('op-0', 'enrolment', 'create', enrolment({ learners: 350 }), 0)]);

    await sync([syncOperation('op-1', 'dailyFeeding', 'create', feeding(), 0)]);

    expect(await flagsFor('daily_feeding')).toContainEqual({
      flag: 'fed_exceeds_enrolled', detail: '400 learners fed but 350 enrolled this term',
    });
  });

  it('flags food issued far from the ration, and more issued than the store held', async () => {
    // 400 learners × 150 g = 60 kg of cereals; 90 kg is 50% over. No pulses were delivered.
    await sync([syncOperation('op-0', 'stockMovement', 'create', delivery(), 0)]);

    await sync([syncOperation('op-1', 'dailyFeeding', 'create', feeding({ cerealsKg: 90 }), 0)]);

    const flags = await flagsFor('daily_feeding');
    expect(flags.map((f) => f.flag)).toEqual(['issue_exceeds_stock', 'usage_far_from_ration']);
    expect(flags[0].detail).toBe('pulses: 16 kg more issued than the store held');
    expect(flags[1].detail).toBe('90 kg of cereals for 400 learners fed; the ration is 60 kg');
  });

  it('raises no stock or ration flag for a normal day with food in the store', async () => {
    await sync([
      syncOperation('op-0', 'stockMovement', 'create', delivery(), 0),
      syncOperation('op-1', 'stockMovement', 'create', delivery({ commodity: 'pulses', quantityKg: 120 }), 0),
    ]);

    await sync([syncOperation('op-2', 'dailyFeeding', 'create', feeding(), 0)]);

    expect(await flagsFor('daily_feeding')).toEqual([]);
  });

  it('does not read rounding to half a kilogram as far from the ration at a small school', async () => {
    await sync([
      syncOperation('op-0', 'stockMovement', 'create', delivery(), 0),
      syncOperation('op-1', 'stockMovement', 'create', delivery({ commodity: 'pulses', quantityKg: 120 }), 0),
    ]);

    // 20 learners: 3 kg of cereals and 0.8 kg of pulses by the ration, recorded to the nearest 0.5 kg
    await sync([syncOperation('op-2', 'dailyFeeding', 'create',
      feeding({ learnersPresent: 20, learnersFed: 20, cerealsKg: 3, pulsesKg: 0.5 }), 0)]);

    expect((await flagsFor('daily_feeding')).map((f) => f.flag)).not.toContain('usage_far_from_ration');
  });
});

describe('termly enrolment', () => {
  it('saves enrolment by class and sex, and an edit clears its verification', async () => {
    const created = await sync([syncOperation('op-1', 'enrolment', 'create', enrolment(), 0)]);
    const recordId = created.body.results[0].recordId;
    await pool.query("UPDATE enrolment SET verified_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', verified_at = NOW()");

    await sync([{ ...syncOperation('op-2', 'enrolment', 'update', enrolment({ learners: 55 }), 1), baseRecordId: recordId }]);

    const row = (await pool.query('SELECT learners, version, verified_by FROM enrolment')).rows[0];
    expect(row).toEqual({ learners: 55, version: 2, verified_by: null });
  });

  it('refuses an unknown class', async () => {
    const res = await sync([syncOperation('op-1', 'enrolment', 'create', enrolment({ class: 'Form 1' }), 0)]);

    expect(res.status).toBe(400);
  });
});

describe('the stock ledger', () => {
  it('records a delivery against its reference, and recognises a replay', async () => {
    const entry = delivery();
    const first = await sync([syncOperation('op-1', 'stockMovement', 'create', entry, 0)]);

    const replay = await sync([syncOperation('op-2', 'stockMovement', 'create', entry, 0)], { clientId: 'device-b' });

    expect(first.body.results[0]).toMatchObject({ status: 'synced', recordId: entry.id, version: 1 });
    expect(replay.body.results[0]).toMatchObject({ status: 'synced', recordId: entry.id });
    expect((await pool.query('SELECT count(*)::int AS n FROM stock_movements')).rows[0].n).toBe(1);
  });

  it('refuses a delivery without a reference, and any edit to an entry', async () => {
    const noReference = await sync([syncOperation('op-1', 'stockMovement', 'create', delivery({ reference: ' ' }), 0)]);
    const edit = await sync([syncOperation('op-2', 'stockMovement', 'update', delivery(), 1)]);

    expect(noReference.status).toBe(400);
    expect(noReference.body.error).toMatch(/delivery note or dispatch reference/);
    expect(edit.status).toBe(400);
    expect(edit.body.error).toMatch(/reversing entry/);
  });

  it('does not let an entry id be reused for a different entry', async () => {
    const entry = delivery();
    await sync([syncOperation('op-1', 'stockMovement', 'create', entry, 0)]);

    const res = await sync([syncOperation('op-2', 'stockMovement', 'create', { ...entry, quantityKg: 900 }, 0)]);

    expect(res.body.results[0]).toMatchObject({ status: 'failed' });
    expect((await pool.query('SELECT quantity_kg FROM stock_movements')).rows[0].quantity_kg).toBe('500.00');
  });

  it('corrects an entry with a reversal, which cannot itself be reversed', async () => {
    const entry = delivery();
    const reversal = { id: entryId(), schoolId: SCHOOL_ID, movementDate: '06-10-2026', commodity: 'cereals', kind: 'reversal', quantityKg: 500, reversesId: entry.id };
    await sync([syncOperation('op-1', 'stockMovement', 'create', entry, 0)]);

    const reversed = await sync([syncOperation('op-2', 'stockMovement', 'create', reversal, 0)]);
    const again = await sync([syncOperation('op-3', 'stockMovement', 'create', { ...reversal, id: entryId(), reversesId: reversal.id }, 0)]);

    expect(reversed.body.results[0]).toMatchObject({ status: 'synced' });
    expect(again.body.results[0]).toMatchObject({ status: 'failed', message: 'A reversal cannot itself be reversed' });
    const balance = (await pool.query("SELECT SUM(quantity_kg)::float AS kg FROM stock_flows WHERE commodity = 'cereals'")).rows[0];
    expect(balance.kg).toBe(0);
  });

  it('flags a delivery lighter than its note', async () => {
    await sync([syncOperation('op-1', 'stockMovement', 'create', delivery({ quantityKg: 450, noteQuantityKg: 500 }), 0)]);

    expect(await flagsFor('stock_movement')).toEqual([{
      flag: 'delivery_short', detail: '450 kg of cereals received; DN-2026-114 says 500 kg',
    }]);
  });

  it('keeps the reason for a late stock entry', async () => {
    // The test clock is 8 October; 28 September is more than 3 school days back
    const res = await sync([syncOperation('op-1', 'stockMovement', 'create',
      delivery({ movementDate: '28-09-2026', lateReason: 'Entered from the store book' }), 0)]);

    expect(res.body.results[0]).toMatchObject({ status: 'synced' });
    expect((await pool.query('SELECT late_reason FROM stock_movements')).rows[0].late_reason).toBe('Entered from the store book');
    expect((await flagsFor('stock_movement')).map((f) => f.detail)).toContainEqual(expect.stringContaining('Reason: Entered from the store book'));
  });

  it('records a physical stock count', async () => {
    const count = { id: entryId(), schoolId: SCHOOL_ID, countDate: '07-10-2026', commodity: 'cereals', countedKg: 412.5 };

    const res = await sync([syncOperation('op-1', 'stockCount', 'create', count, 0)]);

    expect(res.body.results[0]).toMatchObject({ status: 'synced' });
    expect((await pool.query('SELECT counted_kg FROM stock_counts')).rows[0].counted_kg).toBe('412.50');
  });
});

describe('who can send records', () => {
  it('lets school staff record for their own school on their school device', async () => {
    const res = await sync([syncOperation('op-1', 'dailyFeeding', 'create', feeding(), 0)], { as: asStaff });

    expect(res.body.results[0]).toMatchObject({ status: 'synced' });
  });

  it('refuses school staff recording for another school', async () => {
    const res = await sync([syncOperation('op-1', 'dailyFeeding', 'create', feeding({ schoolId: OTHER_SCHOOL_ID }), 0)], { as: asStaff });

    expect(res.status).toBe(400);
  });

  it('refuses programme officers, who review records rather than send them', async () => {
    const res = await sync([syncOperation('op-1', 'dailyFeeding', 'create', feeding(), 0)], { as: asOfficer });

    expect(res.status).toBe(403);
  });
});

describe('the same delivery note entered twice', () => {
  const ledgerCereals = async () => Number((await pool.query(
    "SELECT COALESCE(SUM(quantity_kg), 0) AS kg FROM stock_flows WHERE school_id = $1 AND commodity = 'cereals'", [SCHOOL_ID]
  )).rows[0].kg);

  it('holds the second entry instead of counting the food twice', async () => {
    await sync([syncOperation('op-1', 'stockMovement', 'create', delivery(), 0)]);

    // The head teacher's tablet records the same note, with its own entry id
    const second = await sync([syncOperation('op-2', 'stockMovement', 'create', delivery({ reference: ' dn-2026-114 ' }), 0)], { clientId: 'device-b' });

    expect(second.body.results[0]).toMatchObject({ status: 'held', reason: 'duplicate_delivery' });
    expect(await ledgerCereals()).toBe(500);
    const held = (await asAdmin.get('/api/sync/held')).body.held;
    expect(held).toEqual([expect.objectContaining({ reason: 'duplicate_delivery', reasonText: expect.stringMatching(/same delivery note/) })]);
  });

  it('accepts the same note for another commodity, and again once the first entry is reversed', async () => {
    const first = delivery();
    await sync([syncOperation('op-1', 'stockMovement', 'create', first, 0)]);

    const pulses = await sync([syncOperation('op-2', 'stockMovement', 'create', delivery({ commodity: 'pulses', quantityKg: 120 }), 0)]);
    const reversal = { id: entryId(), schoolId: SCHOOL_ID, movementDate: '06-10-2026', commodity: 'cereals', kind: 'reversal', quantityKg: 500, reversesId: first.id };
    await sync([syncOperation('op-3', 'stockMovement', 'create', reversal, 0)]);
    const corrected = await sync([syncOperation('op-4', 'stockMovement', 'create', delivery({ quantityKg: 450 }), 0)]);

    expect(pulses.body.results[0].status).toBe('synced');
    expect(corrected.body.results[0].status).toBe('synced');
    expect(await ledgerCereals()).toBe(450);
  });

  it('counts a held delivery once an administrator applies it', async () => {
    await sync([syncOperation('op-1', 'stockMovement', 'create', delivery(), 0)]);
    await sync([syncOperation('op-2', 'stockMovement', 'create', delivery({ quantityKg: 300 }), 0)], { clientId: 'device-b' });
    const [held] = (await asAdmin.get('/api/sync/held')).body.held;

    const res = await asAdmin.post(`/api/sync/held/${held.id}/apply`);

    expect(res.status).toBe(200);
    expect(await ledgerCereals()).toBe(800);
  });
});
