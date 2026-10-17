const app = require('../src/app');
const { api, USERS } = require('./helpers/auth');

const asAdmin = api(app);
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
  return asAdmin.post('/api/sync').send({ clientId, operations });
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

    const list = await asAdmin.get('/api/sync/conflicts?status=unresolved');
    const one = await asAdmin.get(`/api/sync/conflicts/${conflictId}`);

    expect(list.status).toBe(200);
    expect(list.body.conflicts.map((c) => c.conflict_id)).toEqual([conflictId]);
    expect(one.status).toBe(200);
    expect(one.body.conflict).toMatchObject({ conflict_id: conflictId, server_version: 2, base_version: 1 });
  });

  it('returns 404 for an unknown conflict', async () => {
    const res = await asAdmin.get(`/api/sync/conflicts/${MISSING_ID}`);

    expect(res.status).toBe(404);
  });
});

describe('resolving conflicts', () => {
  function resolve(conflictId, resolution, values) {
    return asAdmin.post(`/api/sync/conflicts/${conflictId}/resolve`).send({ resolution, values, clientId: 'device-a' });
  }

  it('keep_local applies the offline values and bumps the version', async () => {
    const { conflictId } = await createAttendanceConflict();

    const res = await resolve(conflictId, 'keep_local');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, resolution: 'keep_local', version: 3 });
    expect(await attendanceRow()).toEqual({ total_present: 80, version: 3 });

    const conflict = await pool.query('SELECT status, resolution, resolved_by FROM conflicts WHERE conflict_id = $1', [conflictId]);
    expect(conflict.rows[0]).toEqual({ status: 'resolved', resolution: 'keep_local', resolved_by: USERS.admin.id });
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

    const res = await resolve(conflictId, 'combine');

    expect(res.status).toBe(400);
  });

  it('merge applies the edited values, bumps the version and records the choice', async () => {
    const { conflictId } = await createAttendanceConflict();

    const res = await resolve(conflictId, 'merge', { totalRegistered: 100, totalPresent: 84, totalAbsent: 16 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, resolution: 'merge', version: 3 });
    expect(await attendanceRow()).toEqual({ total_present: 84, version: 3 });
    const conflict = await pool.query('SELECT status, resolution, resolved_by FROM conflicts WHERE conflict_id = $1', [conflictId]);
    expect(conflict.rows[0]).toEqual({ status: 'resolved', resolution: 'merge', resolved_by: USERS.admin.id });
  });

  it('merge rejects values that break the record rules and leaves the conflict open', async () => {
    const { conflictId } = await createAttendanceConflict();

    const res = await resolve(conflictId, 'merge', { totalRegistered: 100, totalPresent: 84, totalAbsent: 10 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Total present + total absent must equal total registered');
    expect(await attendanceRow()).toEqual({ total_present: 88, version: 2 });
    const conflict = await pool.query('SELECT status FROM conflicts WHERE conflict_id = $1', [conflictId]);
    expect(conflict.rows[0].status).toBe('unresolved');
  });

  it('merge needs every count', async () => {
    const { conflictId } = await createAttendanceConflict();

    const res = await resolve(conflictId, 'merge', { totalPresent: 84 });

    expect(res.status).toBe(400);
  });

  it('merge checks meal values too (served cannot exceed prepared)', async () => {
    await sync('device-a', [syncOperation('op-m1', 'mealDistribution', 'create', mealPayload(), 0)]);
    await sync('device-b', [syncOperation('op-m2', 'mealDistribution', 'update', mealPayload({ mealsServed: 95 }), 1)]);
    const stale = await sync('device-a', [syncOperation('op-m3', 'mealDistribution', 'update', mealPayload({ mealsServed: 70 }), 1)]);
    const { conflictId } = stale.body.results[0];

    const tooMany = await resolve(conflictId, 'merge', { mealsPrepared: 100, mealsServed: 120 });
    const ok = await resolve(conflictId, 'merge', { mealsPrepared: 100, mealsServed: 90 });

    expect(tooMany.status).toBe(400);
    expect(ok.status).toBe(200);
    const meal = await pool.query("SELECT meals_served, version FROM meal_distributions WHERE distribution_date = '2026-10-06'");
    expect(meal.rows[0]).toEqual({ meals_served: 90, version: 3 });
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

// #70: the same school and date recorded on two devices while offline. The second create
// used to be reported as synced while its numbers were silently dropped.
describe('the same day recorded on two devices', () => {
  const createOn = (clientId, opId, payload, entityType = 'attendance') =>
    sync(clientId, [syncOperation(opId, entityType, 'create', payload, 0)]);

  it('reports different numbers as a conflict and keeps both versions', async () => {
    await createOn('device-a', 'op-a', attendancePayload());

    const res = await createOn('device-b', 'op-b', attendancePayload({ totalPresent: 80, totalAbsent: 20 }));

    const result = res.body.results[0];
    expect(result).toMatchObject({ success: false, status: 'conflict', baseVersion: 0, serverVersion: 1 });
    expect(result.localPayload).toMatchObject({ totalPresent: 80 });
    expect(await attendanceRow()).toEqual({ total_present: 90, version: 1 });
    const conflict = await pool.query('SELECT status, base_version, server_version, local_payload FROM conflicts WHERE conflict_id = $1', [result.conflictId]);
    expect(conflict.rows[0]).toMatchObject({ status: 'unresolved', base_version: 0, server_version: 1, local_payload: expect.objectContaining({ totalPresent: 80 }) });
  });

  it('treats identical numbers as the same record, keeping the original details', async () => {
    const first = (await createOn('device-a', 'op-a', attendancePayload())).body.results[0];

    const second = (await createOn('device-b', 'op-b', attendancePayload())).body.results[0];

    expect(second).toMatchObject({ success: true, status: 'synced', recordId: first.recordId, version: 1 });
    expect((await pool.query('SELECT count(*)::int AS n FROM conflicts')).rows[0].n).toBe(0);
    const history = await pool.query('SELECT version FROM record_history WHERE record_id = $1', [first.recordId]);
    expect(history.rows).toEqual([{ version: 1 }]);
  });

  it('works the same way for meal records', async () => {
    await createOn('device-a', 'op-a', mealPayload(), 'mealDistribution');

    const different = (await createOn('device-b', 'op-b', mealPayload({ mealsServed: 70 }), 'mealDistribution')).body.results[0];
    const identical = (await createOn('device-c', 'op-c', mealPayload(), 'mealDistribution')).body.results[0];

    expect(different).toMatchObject({ status: 'conflict', serverVersion: 1 });
    expect(identical).toMatchObject({ status: 'synced', version: 1 });
  });

  it('returns the same conflict when the second device sends it again', async () => {
    await createOn('device-a', 'op-a', attendancePayload());
    const first = (await createOn('device-b', 'op-b', attendancePayload({ totalPresent: 80, totalAbsent: 20 }))).body.results[0];

    const again = (await createOn('device-b', 'op-b', attendancePayload({ totalPresent: 80, totalAbsent: 20 }))).body.results[0];

    expect(again).toMatchObject({ status: 'conflict', conflictId: first.conflictId });
    expect((await pool.query('SELECT count(*)::int AS n FROM conflicts')).rows[0].n).toBe(1);
  });

  it('lets an administrator keep the second device’s numbers', async () => {
    await createOn('device-a', 'op-a', attendancePayload());
    const { conflictId } = (await createOn('device-b', 'op-b', attendancePayload({ totalPresent: 80, totalAbsent: 20 }))).body.results[0];

    const res = await asAdmin.post(`/api/sync/conflicts/${conflictId}/resolve`).send({ resolution: 'keep_local', clientId: 'device-b' });

    expect(res.status).toBe(200);
    expect(await attendanceRow()).toEqual({ total_present: 80, version: 2 });
  });

  it('lets an administrator keep the numbers already on the server', async () => {
    await createOn('device-a', 'op-a', attendancePayload());
    const { conflictId } = (await createOn('device-b', 'op-b', attendancePayload({ totalPresent: 80, totalAbsent: 20 }))).body.results[0];

    await asAdmin.post(`/api/sync/conflicts/${conflictId}/resolve`).send({ resolution: 'keep_server', clientId: 'device-b' });

    expect(await attendanceRow()).toEqual({ total_present: 90, version: 1 });
  });
});
