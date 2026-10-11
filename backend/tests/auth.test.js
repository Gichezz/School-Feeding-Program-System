const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { getJwtSecret } = require('../src/config/auth');
const { api, tokenFor, USERS } = require('./helpers/auth');
const { pool, SCHOOL_ID, resetDatabase, attendancePayload, syncOperation } = require('./helpers/fixtures');

beforeEach(resetDatabase);
afterAll(() => pool.end());

function login(email, password) {
  return request(app).post('/api/auth/login').send({ email, password });
}

describe('POST /api/auth/login', () => {
  it('returns a 7-day session token and the user for valid credentials', async () => {
    const res = await login(USERS.staff.email, USERS.staff.password);

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: USERS.staff.id, name: USERS.staff.name, email: USERS.staff.email, role: 'school_staff' });
    expect(res.body.user).not.toHaveProperty('password_hash');
    const payload = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(payload).toMatchObject({ sub: USERS.staff.id, role: 'school_staff' });
    expect(payload.exp - payload.iat).toBe(7 * 24 * 60 * 60);
    expect(new Date(res.body.expiresAt).getTime()).toBe(payload.exp * 1000);
  });

  it('accepts the email in any letter case', async () => {
    const res = await login(USERS.admin.email.toUpperCase(), USERS.admin.password);

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
  });

  it.each([
    ['a wrong password', USERS.admin.email, 'wrong-password'],
    ['an unknown email', 'nobody@demo-school.local', 'ChangeMeAdmin1'],
  ])('rejects %s with the same generic message', async (_, email, password) => {
    const res = await login(email, password);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid email or password' });
  });

  it('rejects a missing password with 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: USERS.admin.email });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the signed-in user', async () => {
    const res = await api(app, 'staff').get('/api/auth/me');

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: USERS.staff.id, role: 'school_staff' });
  });
});

describe('protected routes', () => {
  it('keeps the health check public', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
  });

  it.each([
    ['GET', '/api/auth/me'],
    ['GET', '/api/schools'],
    ['GET', '/api/attendance'],
    ['POST', '/api/attendance'],
    ['GET', '/api/meals'],
    ['POST', '/api/meals'],
    ['POST', '/api/sync'],
    ['GET', '/api/sync/conflicts'],
    ['GET', '/api/reports/dashboard'],
    ['GET', `/api/forecasts?school_id=${SCHOOL_ID}`],
  ])('%s %s requires a session', async (method, path) => {
    const res = method === 'GET' ? await request(app).get(path) : await request(app).post(path).send({});

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Sign in required' });
  });

  it.each([
    ['a token signed with another secret', () => jwt.sign({ role: 'admin' }, 'some-other-secret-0123456789abcdef', { subject: USERS.admin.id })],
    ['a malformed token', () => 'not-a-token'],
  ])('rejects %s', async (_, makeToken) => {
    const res = await request(app).get('/api/schools').set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid session' });
  });

  it('asks the user to sign in again when the session has expired', async () => {
    const expired = tokenFor('staff', { expiresIn: -10 });

    const res = await request(app).get('/api/schools').set('Authorization', `Bearer ${expired}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Session expired, please sign in again' });
  });

  it('rejects a non-Bearer authorization header', async () => {
    const res = await request(app).get('/api/schools').set('Authorization', `Basic ${tokenFor('admin')}`);

    expect(res.status).toBe(401);
  });
});

describe('roles', () => {
  async function createConflict() {
    const asStaff = api(app, 'staff');
    const sync = (clientId, op) => asStaff.post('/api/sync').send({ clientId, operations: [op] });
    await sync('device-a', syncOperation('op-1', 'attendance', 'create', attendancePayload(), 0));
    await sync('device-b', syncOperation('op-2', 'attendance', 'update', attendancePayload({ totalPresent: 88, totalAbsent: 12 }), 1));
    const res = await sync('device-a', syncOperation('op-3', 'attendance', 'update', attendancePayload({ totalPresent: 80, totalAbsent: 20 }), 1));
    return res.body.results[0].conflictId;
  }

  it('lets school staff record, sync and view conflicts', async () => {
    const conflictId = await createConflict();

    const list = await api(app, 'staff').get('/api/sync/conflicts');

    expect(conflictId).toEqual(expect.any(String));
    expect(list.status).toBe(200);
    expect(list.body.conflicts).toHaveLength(1);
  });

  it('does not let school staff resolve conflicts', async () => {
    const conflictId = await createConflict();

    const res = await api(app, 'staff').post(`/api/sync/conflicts/${conflictId}/resolve`).send({ resolution: 'keep_local' });

    expect(res.status).toBe(403);
    const conflict = await pool.query('SELECT status FROM conflicts WHERE conflict_id = $1', [conflictId]);
    expect(conflict.rows[0].status).toBe('unresolved');
  });

  it('lets an admin resolve conflicts and records who did it', async () => {
    const conflictId = await createConflict();

    const res = await api(app, 'admin').post(`/api/sync/conflicts/${conflictId}/resolve`).send({ resolution: 'keep_local' });

    expect(res.status).toBe(200);
    const conflict = await pool.query('SELECT resolved_by FROM conflicts WHERE conflict_id = $1', [conflictId]);
    expect(conflict.rows[0].resolved_by).toBe(USERS.admin.id);
    const record = await pool.query("SELECT updated_by FROM attendance_records WHERE attendance_date = '2026-10-06'");
    expect(record.rows[0].updated_by).toBe(USERS.admin.id);
  });
});

describe('audit fields', () => {
  it('records the signed-in user as updated_by on synced records', async () => {
    await api(app, 'staff').post('/api/sync').send({
      clientId: 'device-a',
      operations: [syncOperation('op-1', 'attendance', 'create', attendancePayload(), 0)],
    });

    const record = await pool.query("SELECT updated_by FROM attendance_records WHERE attendance_date = '2026-10-06'");
    expect(record.rows[0].updated_by).toBe(USERS.staff.id);
  });

  it('ignores an updated_by sent in the request body', async () => {
    const res = await api(app, 'staff').post('/api/attendance').send({
      school_id: SCHOOL_ID,
      attendance_date: '05-10-2026',
      total_registered: 100,
      total_present: 95,
      total_absent: 5,
      updated_by: USERS.admin.id,
    });

    expect(res.status).toBe(201);
    expect(res.body.attendance.updated_by).toBe(USERS.staff.id);
  });
});

describe('JWT secret configuration', () => {
  const original = process.env.JWT_SECRET;
  afterEach(() => {
    process.env.JWT_SECRET = original;
  });

  it.each([
    ['missing', undefined],
    ['too short', 'short-secret'],
    ['the .env.example placeholder', 'replace-with-a-long-random-secret-of-at-least-32-characters'],
  ])('is refused when %s', (_, value) => {
    if (value === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = value;

    expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);
  });
});
