const app = require('../src/app');
const { api, USERS } = require('./helpers/auth');
const { pool, SCHOOL_ID, TEST_DEVICE_ID, resetDatabase, attendancePayload, syncOperation } = require('./helpers/fixtures');

const asAdmin = api(app, 'admin');
const asStaff = api(app, 'staff');
const COLLEAGUE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

beforeEach(async () => {
  await resetDatabase();
  // A second staff member at the same school, sharing the test device
  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, role, school_id)
     VALUES ($1, 'Mary Wanjiru', 'mary@example.org', '$2a$10$abcdefghijklmnopqrstuuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 'school_staff', $2)`,
    [COLLEAGUE_ID, SCHOOL_ID]
  );
});
afterAll(() => pool.end());

/**
 * A queued operation as the device sends it: who captured it, where and when.
 */
function captured(id, { capturedBy = USERS.staff.id, deviceId = TEST_DEVICE_ID, capturedAt = new Date().toISOString(), date = '06-10-2026' } = {}) {
  return { ...syncOperation(id, 'attendance', 'create', attendancePayload({ attendanceDate: date }), 0), capturedBy, deviceId, capturedAt };
}

function sync(operations, as = asStaff) {
  return as.post('/api/sync').send({ clientId: 'device-a', operations });
}

async function attendanceCount() {
  return (await pool.query('SELECT count(*)::int AS n FROM attendance_records WHERE attendance_date = $1', ['2026-10-06'])).rows[0].n;
}

describe('records captured by the signed-in user', () => {
  it('are applied, and the server records who captured them, on which device and when', async () => {
    const capturedAt = '2026-10-06T08:15:00.000Z';

    const res = await sync([captured('op-1', { capturedAt })]);

    expect(res.body.results[0]).toMatchObject({ status: 'synced' });
    const op = await pool.query("SELECT captured_by, device_id, captured_at FROM sync_operations WHERE operation_id = 'op-1'");
    expect(op.rows[0]).toEqual({ captured_by: USERS.staff.id, device_id: TEST_DEVICE_ID, captured_at: new Date(capturedAt) });
  });

  it('still work from older devices that send no capture details', async () => {
    const res = await sync([syncOperation('op-old', 'attendance', 'create', attendancePayload(), 0)]);

    expect(res.body.results[0].status).toBe('synced');
  });

  it('are still applied after the person changed their own password', async () => {
    const capturedAt = new Date(Date.now() - 60000).toISOString();
    await asStaff.put('/api/auth/password').send({ currentPassword: USERS.staff.password, newPassword: 'a-brand-new-password' });

    // Their session continues with a new token; the old queued record still belongs to them
    await pool.query('UPDATE users SET password_changed_at = NULL WHERE id = $1', [USERS.staff.id]);
    const res = await sync([captured('op-own', { capturedAt })]);

    expect(res.body.results[0].status).toBe('synced');
  });
});

describe('records captured by a colleague on the same device', () => {
  it('are deferred: never applied under someone else’s session, and not held', async () => {
    const res = await sync([captured('op-mary', { capturedBy: COLLEAGUE_ID })]);

    expect(res.body.results[0]).toMatchObject({ status: 'deferred' });
    expect(await attendanceCount()).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM held_operations')).rows[0].n).toBe(0);
  });
});

describe('records the server holds for review', () => {
  it('from someone who has been deactivated', async () => {
    await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [COLLEAGUE_ID]);

    const res = await sync([captured('op-gone', { capturedBy: COLLEAGUE_ID })]);

    expect(res.body.results[0]).toMatchObject({ status: 'held', reason: 'user_deactivated', capturedBy: COLLEAGUE_ID });
    expect(await attendanceCount()).toBe(0);
    const held = await pool.query("SELECT reason, captured_by, submitted_by, device_id, status FROM held_operations WHERE operation_id = 'op-gone'");
    expect(held.rows[0]).toEqual({ reason: 'user_deactivated', captured_by: COLLEAGUE_ID, submitted_by: USERS.staff.id, device_id: TEST_DEVICE_ID, status: 'pending' });
  });

  it('captured before an administrator reset the person’s password', async () => {
    const before = new Date(Date.now() - 60000).toISOString();
    await asAdmin.post(`/api/users/${USERS.staff.id}/password`).send({ password: 'reset-by-admin-1' });
    await pool.query('UPDATE users SET password_changed_at = NULL WHERE id = $1', [USERS.staff.id]); // keep this test session alive

    const old = await sync([captured('op-before', { capturedAt: before })]);
    const fresh = await sync([captured('op-after', { capturedAt: new Date(Date.now() + 1000).toISOString(), date: '07-10-2026' })]);

    expect(old.body.results[0]).toMatchObject({ status: 'held', reason: 'password_reset' });
    expect(fresh.body.results[0].status).toBe('synced');
  });

  it('captured on a device that has since been removed', async () => {
    await pool.query(
      "INSERT INTO devices (id, school_id, name, status, public_key) VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', $1, 'Lost tablet', 'revoked', '{}')",
      [SCHOOL_ID]
    );

    const res = await sync([captured('op-lost', { deviceId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' })]);

    expect(res.body.results[0]).toMatchObject({ status: 'held', reason: 'device_revoked' });
  });

  it('stays held, once, when the device sends it again', async () => {
    await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [COLLEAGUE_ID]);
    await sync([captured('op-gone', { capturedBy: COLLEAGUE_ID })]);

    const again = await sync([captured('op-gone', { capturedBy: COLLEAGUE_ID })]);

    expect(again.body.results[0]).toMatchObject({ status: 'held' });
    expect((await pool.query('SELECT count(*)::int AS n FROM held_operations')).rows[0].n).toBe(1);
  });

  it('rejects capture details that are not valid', async () => {
    const res = await sync([{ ...captured('op-bad'), capturedBy: 'someone' }]);

    expect(res.status).toBe(400);
  });
});

describe('reviewing held records', () => {
  beforeEach(async () => {
    await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [COLLEAGUE_ID]);
    await sync([captured('op-gone', { capturedBy: COLLEAGUE_ID, capturedAt: '2026-10-06T08:15:00.000Z' })]);
  });

  async function heldId() {
    return (await asAdmin.get('/api/sync/held')).body.held[0].id;
  }

  it('lists them for administrators with who, where, when and why', async () => {
    const res = await asAdmin.get('/api/sync/held');

    expect(res.body.held).toEqual([expect.objectContaining({
      entityType: 'attendance',
      reason: 'user_deactivated',
      reasonText: expect.stringMatching(/deactivated/),
      capturedBy: 'Mary Wanjiru',
      device: 'Test school device',
      submittedBy: USERS.staff.name,
      payload: expect.objectContaining({ attendanceDate: '06-10-2026' }),
    })]);
    expect((await asStaff.get('/api/sync/held')).status).toBe(403);
  });

  it('applies one, keeping the person who captured it as the author', async () => {
    const res = await asAdmin.post(`/api/sync/held/${await heldId()}/apply`);

    expect(res.status).toBe(200);
    const record = await pool.query("SELECT updated_by FROM attendance_records WHERE attendance_date = '2026-10-06'");
    expect(record.rows[0].updated_by).toBe(COLLEAGUE_ID);
    const held = await pool.query('SELECT status, reviewed_by FROM held_operations');
    expect(held.rows[0]).toEqual({ status: 'applied', reviewed_by: USERS.admin.id });
    expect((await asAdmin.get('/api/sync/held')).body.held).toEqual([]);
  });

  it('refuses to apply an edit when the server copy has changed since (409)', async () => {
    await sync([captured('op-first', { date: '08-10-2026' })]);
    await pool.query('UPDATE users SET is_active = TRUE WHERE id = $1', [COLLEAGUE_ID]);
    const staleEdit = { ...syncOperation('op-stale', 'attendance', 'update', attendancePayload({ attendanceDate: '08-10-2026', totalPresent: 50, totalAbsent: 50 }), 0), capturedBy: COLLEAGUE_ID, deviceId: TEST_DEVICE_ID, capturedAt: new Date().toISOString() };
    await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [COLLEAGUE_ID]);
    await sync([staleEdit]);
    const stale = (await asAdmin.get('/api/sync/held')).body.held.find((h) => h.payload.attendanceDate === '08-10-2026');

    const res = await asAdmin.post(`/api/sync/held/${stale.id}/apply`);

    expect(res.status).toBe(409);
    expect((await pool.query("SELECT status FROM held_operations WHERE operation_id = 'op-stale'")).rows[0].status).toBe('pending');
  });

  it('discards one', async () => {
    const id = await heldId();

    const res = await asAdmin.post(`/api/sync/held/${id}/discard`);

    expect(res.status).toBe(204);
    expect(await attendanceCount()).toBe(0);
    expect((await asAdmin.post(`/api/sync/held/${id}/discard`)).status).toBe(404);
  });
});
