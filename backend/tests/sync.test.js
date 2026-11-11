const app = require('../src/app');
const { api, asSchool } = require('./helpers/auth');

const asAdmin = api(app);
const schoolDevice = asSchool(app);
const {
  pool,
  resetDatabase,
  attendancePayload,
  mealPayload,
  syncOperation,
} = require('./helpers/fixtures');

beforeEach(resetDatabase);
afterAll(() => pool.end());

function sync(clientId, operations) {
  return schoolDevice.post('/api/sync').send({ clientId, operations });
}

describe('POST /api/sync validation', () => {
  it('accepts an empty batch', async () => {
    const res = await sync('device-a', []);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, results: [] });
  });

  it.each([
    ['a missing clientId', { operations: [] }],
    ['operations that are not an array', { clientId: 'device-a', operations: {} }],
    ['an unknown entity type', { clientId: 'device-a', operations: [syncOperation('op-1', 'student', 'create', {}, 0)] }],
    ['an unknown operation', { clientId: 'device-a', operations: [syncOperation('op-1', 'attendance', 'delete', {}, 0)] }],
    ['a missing baseVersion', { clientId: 'device-a', operations: [syncOperation('op-1', 'attendance', 'create', {}, undefined)] }],
  ])('rejects %s with 400', async (_, body) => {
    const res = await schoolDevice.post('/api/sync').send(body);

    expect(res.status).toBe(400);
  });
});

describe('POST /api/sync applying operations', () => {
  it('applies a queued attendance create and records the operation', async () => {
    const res = await sync('device-a', [syncOperation('op-1', 'attendance', 'create', attendancePayload(), 0)]);

    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ success: true, status: 'synced', version: 1 });

    const op = await pool.query("SELECT status, entity_type FROM sync_operations WHERE operation_id = 'op-1'");
    expect(op.rows[0]).toEqual({ status: 'applied', entity_type: 'attendance' });

    const record = await pool.query(
      "SELECT total_present, version FROM attendance_records WHERE attendance_date = '2026-10-06'"
    );
    expect(record.rows[0]).toEqual({ total_present: 90, version: 1 });
  });

  it('applies a queued meal distribution create', async () => {
    const res = await sync('device-a', [syncOperation('op-m1', 'mealDistribution', 'create', mealPayload(), 0)]);

    expect(res.body.results[0]).toMatchObject({ success: true, status: 'synced', version: 1 });
    const op = await pool.query("SELECT entity_type FROM sync_operations WHERE operation_id = 'op-m1'");
    expect(op.rows[0].entity_type).toBe('meal_distribution');
  });

  it('treats a replayed operation id as already applied', async () => {
    const operation = syncOperation('op-1', 'attendance', 'create', attendancePayload(), 0);
    await sync('device-a', [operation]);

    const res = await sync('device-a', [operation]);

    expect(res.body.results[0]).toMatchObject({ success: true, status: 'synced', version: 1 });
    expect(res.body.results[0].message).toMatch(/idempotent/);
    const count = await pool.query('SELECT count(*)::int AS n FROM attendance_records WHERE attendance_date = $1', ['2026-10-06']);
    expect(count.rows[0].n).toBe(1);
  });

  it('applies an update based on the current version and increments it', async () => {
    await sync('device-a', [syncOperation('op-1', 'attendance', 'create', attendancePayload(), 0)]);

    const res = await sync('device-b', [
      syncOperation('op-2', 'attendance', 'update', attendancePayload({ totalPresent: 88, totalAbsent: 12 }), 1),
    ]);

    expect(res.body.results[0]).toMatchObject({ success: true, status: 'synced', version: 2 });
    const record = await pool.query(
      "SELECT total_present, version FROM attendance_records WHERE attendance_date = '2026-10-06'"
    );
    expect(record.rows[0]).toEqual({ total_present: 88, version: 2 });
  });

  it('treats an edit based on another device’s record as a conflict, even when the version matches', async () => {
    // Device A's record for the day is version 1; device B's own create for the same day
    // conflicted, and B's correction is also based on "version 1", but of its own record.
    await sync('device-a', [syncOperation('op-1', 'attendance', 'create', attendancePayload(), 0)]);
    const otherRecordId = '99999999-9999-4999-8999-999999999999';

    const res = await sync('device-b', [{
      ...syncOperation('op-2', 'attendance', 'update', attendancePayload({ totalPresent: 70, totalAbsent: 30 }), 1),
      baseRecordId: otherRecordId,
    }]);

    expect(res.body.results[0]).toMatchObject({ status: 'conflict' });
    const record = await pool.query(
      "SELECT total_present, version FROM attendance_records WHERE attendance_date = '2026-10-06'"
    );
    expect(record.rows[0]).toEqual({ total_present: 90, version: 1 });
  });

  it('applies an edit that names the record it was based on', async () => {
    const created = await sync('device-a', [syncOperation('op-1', 'attendance', 'create', attendancePayload(), 0)]);

    const res = await sync('device-a', [{
      ...syncOperation('op-2', 'attendance', 'update', attendancePayload({ totalPresent: 88, totalAbsent: 12 }), 1),
      baseRecordId: created.body.results[0].recordId,
    }]);

    expect(res.body.results[0]).toMatchObject({ status: 'synced', version: 2 });
  });

  it('rejects a baseRecordId that is not a record id', async () => {
    const res = await sync('device-a', [{
      ...syncOperation('op-1', 'attendance', 'update', attendancePayload(), 1),
      baseRecordId: 'not-an-id',
    }]);

    expect(res.status).toBe(400);
  });

  it('processes each operation in a batch independently', async () => {
    const res = await sync('device-a', [
      syncOperation('op-1', 'attendance', 'create', attendancePayload(), 0),
      syncOperation('op-m1', 'mealDistribution', 'create', mealPayload(), 0),
    ]);

    expect(res.body.results.map((r) => r.status)).toEqual(['synced', 'synced']);
  });
});
