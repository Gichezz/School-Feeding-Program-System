const app = require('../src/app');
const { api, USERS } = require('./helpers/auth');
const { pool, SCHOOL_ID, TEST_DEVICE_ID, resetDatabase, attendancePayload, mealPayload, syncOperation } = require('./helpers/fixtures');

// "Today" in these tests is Thursday 8 October 2026, 09:00 in Nairobi (tests/setupEnv.js)
const asAdmin = api(app, 'admin');
const asStaff = api(app, 'staff');

beforeEach(resetDatabase);
afterAll(() => pool.end());

function postAttendance(body) {
  return asStaff.post('/api/attendance').send({ school_id: SCHOOL_ID, total_registered: 100, total_present: 90, total_absent: 10, ...body });
}

function syncCaptured(id, entityType, payload, { capturedAt = '2026-10-08T06:00:00Z', operation = 'create', baseVersion = 0 } = {}) {
  return asStaff.post('/api/sync').send({
    clientId: 'device-a',
    operations: [{ ...syncOperation(id, entityType, operation, payload, baseVersion), capturedBy: USERS.staff.id, deviceId: TEST_DEVICE_ID, capturedAt }],
  });
}

async function flagsFor(flag) {
  return (await pool.query('SELECT flag, detail FROM record_flags WHERE flag = $1', [flag])).rows;
}

describe('entry window', () => {
  it('refuses future dates', async () => {
    const res = await postAttendance({ attendance_date: '09-10-2026' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/future/);
  });

  it('accepts today and up to 3 school days back without a reason', async () => {
    expect((await postAttendance({ attendance_date: '08-10-2026' })).status).toBe(201);
    // Mon 5 Oct is 3 school days before Thu 8 Oct
    expect((await postAttendance({ attendance_date: '05-10-2026' })).status).toBe(201);
    expect(await flagsFor('entered_late')).toEqual([]);
  });

  it('needs a reason for older dates, then accepts and flags them', async () => {
    // Fri 2 Oct is 4 school days before Thu 8 Oct
    const withoutReason = await postAttendance({ attendance_date: '02-10-2026' });
    const withReason = await postAttendance({ attendance_date: '02-10-2026', late_reason: 'Register was at the head office' });

    expect(withoutReason.status).toBe(400);
    expect(withoutReason.body.error).toMatch(/reason/);
    expect(withReason.status).toBe(201);
    const flags = await flagsFor('entered_late');
    expect(flags).toEqual([{ flag: 'entered_late', detail: expect.stringMatching(/4 school days.*Register was at the head office/) }]);
    const stored = await pool.query("SELECT late_reason FROM attendance_records WHERE attendance_date = '2026-10-02'");
    expect(stored.rows[0].late_reason).toBe('Register was at the head office');
  });

  it('measures from when the record was captured on the device, not when it synced', async () => {
    // Captured on Fri 2 Oct for Thu 1 Oct; reaching the server a week later is not "late"
    const res = await syncCaptured('op-week', 'attendance', attendancePayload({ attendanceDate: '01-10-2026' }), { capturedAt: '2026-10-02T07:00:00Z' });

    expect(res.body.results[0].status).toBe('synced');
    expect(await flagsFor('entered_late')).toEqual([]);
  });

  it('refuses a synced record outside the window without a reason', async () => {
    const res = await syncCaptured('op-old', 'attendance', attendancePayload({ attendanceDate: '01-10-2026' }));

    expect(res.status).toBe(400);
  });
});

describe('tracing who captured each record', () => {
  it('stores who, which device, when captured and when received', async () => {
    await syncCaptured('op-1', 'attendance', attendancePayload({ attendanceDate: '07-10-2026' }), { capturedAt: '2026-10-07T06:30:00Z' });

    const row = (await pool.query("SELECT captured_by, device_id, captured_at, received_at FROM attendance_records WHERE attendance_date = '2026-10-07'")).rows[0];
    expect(row).toEqual({
      captured_by: USERS.staff.id,
      device_id: TEST_DEVICE_ID,
      captured_at: new Date('2026-10-07T06:30:00Z'),
      received_at: new Date('2026-10-08T06:00:00Z'),
    });
  });

  it('keeps every saved version with who changed it', async () => {
    await syncCaptured('op-1', 'attendance', attendancePayload({ attendanceDate: '07-10-2026' }));
    await syncCaptured('op-2', 'attendance', attendancePayload({ attendanceDate: '07-10-2026', totalPresent: 85, totalAbsent: 15 }), { operation: 'update', baseVersion: 1 });
    const record = (await pool.query("SELECT id FROM attendance_records WHERE attendance_date = '2026-10-07'")).rows[0];

    const res = await asAdmin.get(`/api/review/records/attendance/${record.id}/history`);

    expect(res.body.history.map((h) => [h.version, h.values.present, h.changedBy, h.device])).toEqual([
      [1, 90, USERS.staff.name, 'Test school device'],
      [2, 85, USERS.staff.name, 'Test school device'],
    ]);
  });
});

describe('flags', () => {
  it('flags records captured outside school hours, but not during them', async () => {
    await syncCaptured('op-late-evening', 'attendance', attendancePayload({ attendanceDate: '07-10-2026' }), { capturedAt: '2026-10-07T17:30:00Z' });
    await syncCaptured('op-morning', 'attendance', attendancePayload({ attendanceDate: '06-10-2026' }), { capturedAt: '2026-10-06T06:00:00Z' });

    expect(await flagsFor('outside_hours')).toEqual([{ flag: 'outside_hours', detail: expect.stringMatching(/20:30/) }]);
  });

  it('flags records kept offline for more than 3 days', async () => {
    await syncCaptured('op-kept', 'attendance', attendancePayload({ attendanceDate: '02-10-2026' }), { capturedAt: '2026-10-02T07:00:00Z' });

    expect(await flagsFor('synced_late')).toEqual([{ flag: 'synced_late', detail: expect.stringMatching(/5 days/) }]);
  });

  it('flags many more meals served than learners present, whichever is saved first', async () => {
    await syncCaptured('op-a', 'attendance', attendancePayload({ attendanceDate: '07-10-2026', totalPresent: 50, totalAbsent: 50 }));
    await syncCaptured('op-m', 'mealDistribution', mealPayload({ distributionDate: '07-10-2026', mealsPrepared: 100, mealsServed: 80 }));
    await syncCaptured('op-m2', 'mealDistribution', mealPayload({ distributionDate: '06-10-2026', mealsPrepared: 100, mealsServed: 80 }));
    await syncCaptured('op-a2', 'attendance', attendancePayload({ attendanceDate: '06-10-2026', totalPresent: 50, totalAbsent: 50 }));

    expect(await flagsFor('served_exceeds_present')).toEqual([
      { flag: 'served_exceeds_present', detail: '80 meals served but 50 learners present' },
      { flag: 'served_exceeds_present', detail: '80 meals served but 50 learners present' },
    ]);
  });

  it('does not flag meals served within a small margin of learners present', async () => {
    await syncCaptured('op-a', 'attendance', attendancePayload({ attendanceDate: '07-10-2026', totalPresent: 50, totalAbsent: 50 }));
    await syncCaptured('op-m', 'mealDistribution', mealPayload({ distributionDate: '07-10-2026', mealsPrepared: 100, mealsServed: 54 }));

    expect(await flagsFor('served_exceeds_present')).toEqual([]);
  });

  it('flags numbers far from the school’s usual, once it has enough history', async () => {
    // Replace the demo seed's one tiny record with a steady school's history
    await pool.query('DELETE FROM attendance_records');
    for (let day = 1; day <= 12; day += 1) {
      await pool.query(
        `INSERT INTO attendance_records (school_id, attendance_date, total_registered, total_present, total_absent)
         VALUES ($1, $2, 100, $3, $4)`,
        [SCHOOL_ID, `2026-09-${String(day).padStart(2, '0')}`, 88 + (day % 4), 12 - (day % 4)]
      );
    }

    await syncCaptured('op-normal', 'attendance', attendancePayload({ attendanceDate: '06-10-2026', totalPresent: 89, totalAbsent: 11 }));
    await syncCaptured('op-odd', 'attendance', attendancePayload({ attendanceDate: '07-10-2026', totalPresent: 30, totalAbsent: 70 }));

    expect(await flagsFor('unusual_numbers')).toEqual([{ flag: 'unusual_numbers', detail: expect.stringMatching(/^30 learners present; usually about 89$/) }]);
  });
});

describe('reviewing flags', () => {
  beforeEach(async () => {
    await syncCaptured('op-late-evening', 'attendance', attendancePayload({ attendanceDate: '07-10-2026' }), { capturedAt: '2026-10-07T17:30:00Z' });
  });

  it('lists open flags for administrators, with the record, person, device and times', async () => {
    const res = await asAdmin.get('/api/review/flags');

    expect(res.body.openCount).toBe(1);
    expect(res.body.flags).toEqual([expect.objectContaining({
      entityType: 'attendance',
      flag: 'outside_hours',
      title: 'Captured outside school hours',
      school: 'Demo Primary School',
      values: expect.objectContaining({ date: '07-10-2026', present: 90 }),
      capturedBy: USERS.staff.name,
      device: 'Test school device',
      capturedAt: '2026-10-07T17:30:00.000Z',
      status: 'open',
    })]);
    expect((await asStaff.get('/api/review/flags')).status).toBe(403);
  });

  it('marks a flag checked with a note, once', async () => {
    const [flag] = (await asAdmin.get('/api/review/flags')).body.flags;

    const res = await asAdmin.post(`/api/review/flags/${flag.id}/check`).send({ note: 'Matches the paper register' });

    expect(res.status).toBe(200);
    const after = await asAdmin.get('/api/review/flags');
    expect(after.body).toMatchObject({ flags: [], openCount: 0 });
    const checked = await asAdmin.get('/api/review/flags?status=checked');
    expect(checked.body.flags[0]).toMatchObject({ status: 'checked', note: 'Matches the paper register', checkedBy: USERS.admin.name });
    expect((await asAdmin.post(`/api/review/flags/${flag.id}/check`).send({})).status).toBe(404);
  });

  it('refuses a note that is too long', async () => {
    const [flag] = (await asAdmin.get('/api/review/flags')).body.flags;

    expect((await asAdmin.post(`/api/review/flags/${flag.id}/check`).send({ note: 'x'.repeat(501) })).status).toBe(400);
  });
});

describe('administrators’ conflict decisions', () => {
  it('are kept in the record history without being flagged', async () => {
    await syncCaptured('op-1', 'attendance', attendancePayload({ attendanceDate: '07-10-2026' }));
    await asAdmin.post('/api/sync').send({ clientId: 'device-b', operations: [syncOperation('op-2', 'attendance', 'update', attendancePayload({ attendanceDate: '07-10-2026', totalPresent: 88, totalAbsent: 12 }), 1)] });
    const stale = await asStaff.post('/api/sync').send({ clientId: 'device-a', operations: [syncOperation('op-3', 'attendance', 'update', attendancePayload({ attendanceDate: '07-10-2026', totalPresent: 80, totalAbsent: 20 }), 1)] });
    const flagsBefore = (await pool.query('SELECT count(*)::int AS n FROM record_flags')).rows[0].n;

    await asAdmin.post(`/api/sync/conflicts/${stale.body.results[0].conflictId}/resolve`).send({ resolution: 'keep_local', clientId: 'device-a' });

    const record = (await pool.query("SELECT id FROM attendance_records WHERE attendance_date = '2026-10-07'")).rows[0];
    const history = (await asAdmin.get(`/api/review/records/attendance/${record.id}/history`)).body.history;
    expect(history.at(-1)).toMatchObject({ version: 3, changedBy: USERS.admin.name, values: expect.objectContaining({ present: 80 }) });
    expect((await pool.query('SELECT count(*)::int AS n FROM record_flags')).rows[0].n).toBe(flagsBefore);
  });
});
