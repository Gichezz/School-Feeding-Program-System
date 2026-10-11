const request = require('supertest');
const app = require('../src/app');
const {
  pool,
  MISSING_ID,
  resetDatabase,
  attendancePayload,
  mealPayload,
  syncOperation,
} = require('./helpers/fixtures');

beforeEach(resetDatabase);
afterAll(() => pool.end());

function sync(clientId, operations) {
  return request(app).post('/api/sync').send({ clientId, operations });
}

/**
 * Create a record (version 1), update it from device B (version 2), then send a
 * stale update from device A still based on version 1.
 */
async function createAttendanceConflict() {
  await sync('device-a', [syncOperation('op-1', 'attendance', 'create', attendancePayload(), 0)]);
  await sync('device-b', [
    syncOperation('op-2', 'attendance', 'update', attendancePayload({ totalPresent: 88, totalAbsent: 12 }), 1),
  ]);
  const res = await sync('device-a', [
    syncOperation('op-3', 'attendance', 'update', attendancePayload({ totalPresent: 80, totalAbsent: 20 }), 1),
  ]);
  return res.body.results[0];
}

async function attendanceRow() {
  const result = await pool.query(
    "SELECT total_present, version FROM attendance_records WHERE attendance_date = '2026-10-06'"
  );
  return result.rows[0];
}

describe('conflict detection', () => {
  // Regression test for #8: the conflict used to be lost to a foreign key violation.
  it('stores a conflict for a stale update and returns its id', async () => {
    const result = await createAttendanceConflict();

    expect(result).toMatchObject({ success: false, status: 'conflict', baseVersion: 1, serverVersion: 2 });
    expect(result.conflictId).toEqual(expect.any(String));

    const conflict = await pool.query('SELECT status, operation_id, client_id FROM conflicts WHERE conflict_id = $1', [result.conflictId]);
    expect(conflict.rows[0]).toEqual({ status: 'unresolved', operation_id: 'op-3', client_id: 'device-a' });

    const op = await pool.query("SELECT status FROM sync_operations WHERE operation_id = 'op-3'");
    expect(op.rows[0].status).toBe('conflict');
  });

  it('does not overwrite the server record', async () => {
    await createAttendanceConflict();

    expect(await attendanceRow()).toEqual({ total_present: 88, version: 2 });
  });

  it('returns the same conflict when the operation is replayed', async () => {
    const first = await createAttendanceConflict();

    const res = await sync('device-a', [
      syncOperation('op-3', 'attendance', 'update', attendancePayload({ totalPresent: 80, totalAbsent: 20 }), 1),
    ]);

    expect(res.body.results[0]).toMatchObject({ status: 'conflict', conflictId: first.conflictId });
    const count = await pool.query('SELECT count(*)::int AS n FROM conflicts');
    expect(count.rows[0].n).toBe(1);
  });
});

describe('listing conflicts', () => {
  it('lists unresolved conflicts and returns one by id', async () => {
    const { conflictId } = await createAttendanceConflict();

    const list = await request(app).get('/api/sync/conflicts?status=unresolved');
    const one = await request(app).get(`/api/sync/conflicts/${conflictId}`);

    expect(list.status).toBe(200);
    expect(list.body.conflicts.map((c) => c.conflict_id)).toEqual([conflictId]);
    expect(one.status).toBe(200);
    expect(one.body.conflict).toMatchObject({ conflict_id: conflictId, server_version: 2, base_version: 1 });
  });

  it('returns 404 for an unknown conflict', async () => {
    const res = await request(app).get(`/api/sync/conflicts/${MISSING_ID}`);

    expect(res.status).toBe(404);
  });
});

describe('resolving conflicts', () => {
  function resolve(conflictId, resolution) {
    return request(app).post(`/api/sync/conflicts/${conflictId}/resolve`).send({ resolution, clientId: 'device-a' });
  }

  it('keep_local applies the offline values and bumps the version', async () => {
    const { conflictId } = await createAttendanceConflict();

    const res = await resolve(conflictId, 'keep_local');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, resolution: 'keep_local', version: 3 });
    expect(await attendanceRow()).toEqual({ total_present: 80, version: 3 });

    const conflict = await pool.query('SELECT status, resolution, resolved_by FROM conflicts WHERE conflict_id = $1', [conflictId]);
    expect(conflict.rows[0]).toEqual({ status: 'resolved', resolution: 'keep_local', resolved_by: null });
    const op = await pool.query("SELECT status FROM sync_operations WHERE operation_id = 'op-3'");
    expect(op.rows[0].status).toBe('applied');
  });

  it('keep_server leaves the server values unchanged', async () => {
    await sync('device-a', [syncOperation('op-m1', 'mealDistribution', 'create', mealPayload(), 0)]);
    await sync('device-b', [syncOperation('op-m2', 'mealDistribution', 'update', mealPayload({ mealsServed: 95 }), 1)]);
    const stale = await sync('device-a', [syncOperation('op-m3', 'mealDistribution', 'update', mealPayload({ mealsServed: 70 }), 1)]);
    const { conflictId } = stale.body.results[0];

    const res = await resolve(conflictId, 'keep_server');

    expect(res.status).toBe(200);
    const meal = await pool.query(
      "SELECT meals_served, version FROM meal_distributions WHERE distribution_date = '2026-10-06'"
    );
    expect(meal.rows[0]).toEqual({ meals_served: 95, version: 2 });
  });

  it('rejects an unknown strategy with 400', async () => {
    const { conflictId } = await createAttendanceConflict();

    const res = await resolve(conflictId, 'merge');

    expect(res.status).toBe(400);
  });

  it('rejects resolving the same conflict twice with 400', async () => {
    const { conflictId } = await createAttendanceConflict();
    await resolve(conflictId, 'keep_server');

    const res = await resolve(conflictId, 'keep_local');

    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown conflict', async () => {
    const res = await resolve(MISSING_ID, 'keep_local');

    expect(res.status).toBe(404);
  });

  it('returns 409 when the server record changed after the conflict was recorded', async () => {
    const { conflictId } = await createAttendanceConflict();
    await sync('device-b', [
      syncOperation('op-4', 'attendance', 'update', attendancePayload({ totalPresent: 85, totalAbsent: 15 }), 2),
    ]);

    const res = await resolve(conflictId, 'keep_local');

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ currentServerVersion: 3, expectedServerVersion: 2 });
    expect(await attendanceRow()).toEqual({ total_present: 85, version: 3 });
  });
});
