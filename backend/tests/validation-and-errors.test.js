const request = require('supertest');
const app = require('../src/app');
const { api } = require('./helpers/auth');

const asAdmin = api(app);
const errorHandler = require('../src/middleware/errorHandler');
const {
  pool,
  SCHOOL_ID,
  resetDatabase,
  attendancePayload,
  mealPayload,
  syncOperation,
} = require('./helpers/fixtures');

beforeEach(resetDatabase);
afterAll(() => pool.end());

function sync(operations) {
  return asAdmin.post('/api/sync').send({ clientId: 'device-a', operations });
}

describe('sync payload validation', () => {
  it.each([
    ['a malformed school id', 'attendance', attendancePayload({ schoolId: 'abc' })],
    ['an impossible date', 'attendance', attendancePayload({ attendanceDate: '31-02-2026' })],
    ['an ISO date', 'attendance', attendancePayload({ attendanceDate: '2026-10-06' })],
    ['a negative count', 'attendance', attendancePayload({ totalAbsent: -1 })],
    ['a count sent as text', 'attendance', attendancePayload({ totalPresent: '90' })],
    ['a fractional count', 'attendance', attendancePayload({ totalPresent: 89.5 })],
    ['present + absent above registered', 'attendance', attendancePayload({ totalPresent: 95, totalAbsent: 10 })],
    ['present + absent below registered', 'attendance', attendancePayload({ totalPresent: 85, totalAbsent: 10 })],
    ['more meals served than prepared', 'mealDistribution', mealPayload({ mealsServed: 101 })],
    ['a missing meal count', 'mealDistribution', mealPayload({ mealsPrepared: undefined })],
  ])('rejects %s with 400 before writing anything', async (_, entityType, payload) => {
    const res = await sync([syncOperation('op-1', entityType, 'create', payload, 0)]);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^Operation op-1: /);
    const ops = await pool.query('SELECT count(*)::int AS n FROM sync_operations');
    expect(ops.rows[0].n).toBe(0);
  });

  it('rejects more than 100 operations in one request', async () => {
    const operations = Array.from({ length: 101 }, (_, i) =>
      syncOperation(`op-${i}`, 'attendance', 'create', attendancePayload(), 0)
    );

    const res = await sync(operations);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most 100 operations/);
  });

  it('reports an update to a missing record as failed without trying to record it', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await sync([syncOperation('op-1', 'attendance', 'update', attendancePayload(), 1)]);

    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ success: false, status: 'failed', message: 'Record not found' });
    expect(errorSpy).not.toHaveBeenCalledWith('Error recording operation status:', expect.anything());
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('op-1'));
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe('attendance totals in the database', () => {
  it('rejects a row where present + absent does not equal registered', async () => {
    await expect(pool.query(
      `INSERT INTO attendance_records (school_id, attendance_date, total_registered, total_present, total_absent, client_id)
       VALUES ($1, '2026-10-01', 100, 90, 5, 'test')`,
      [SCHOOL_ID]
    )).rejects.toMatchObject({ code: '23514', constraint: 'attendance_present_absent_equals_registered' });
  });
});

describe('REST record validation', () => {
  it.each([
    ['an impossible date', { attendance_date: '30-02-2026' }],
    ['counts sent as text', { total_present: '95' }],
  ])('rejects attendance with %s', async (_, overrides) => {
    const res = await asAdmin.post('/api/attendance').send({
      school_id: SCHOOL_ID,
      attendance_date: '05-10-2026',
      total_registered: 100,
      total_present: 95,
      total_absent: 5,
      ...overrides,
    });

    expect(res.status).toBe(400);
  });

  it('rejects meals with fractional counts', async () => {
    const res = await asAdmin.post('/api/meals').send({
      school_id: SCHOOL_ID,
      distribution_date: '05-10-2026',
      meals_prepared: 100.5,
      meals_served: 90,
    });

    expect(res.status).toBe(400);
  });
});

describe('request body handling', () => {
  it('rejects a body over the size limit with 413', async () => {
    const res = await request(app)
      .post('/api/sync')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ clientId: 'device-a', operations: [], padding: 'x'.repeat(150 * 1024) }));

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Request body too large' });
  });

  it('rejects malformed JSON with 400 and a generic message', async () => {
    const res = await asAdmin.post('/api/attendance').set('Content-Type', 'application/json').send('{"school_id":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Malformed JSON body' });
  });
});

describe('conflict ids', () => {
  it.each([
    ['GET', '/api/sync/conflicts/not-a-uuid'],
    ['POST', '/api/sync/conflicts/not-a-uuid/resolve'],
  ])('%s %s returns 400 without database details', async (method, path) => {
    const res = method === 'GET'
      ? await asAdmin.get(path)
      : await asAdmin.post(path).send({ resolution: 'keep_local' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid conflict ID format' });
  });
});

describe('CORS', () => {
  it('allows only the configured frontend origin', async () => {
    const allowed = await asAdmin.get('/api/health').set('Origin', 'http://localhost:5173');
    const other = await asAdmin.get('/api/health').set('Origin', 'https://example.com');

    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(other.headers['access-control-allow-origin']).not.toBe('https://example.com');
    expect(other.headers['access-control-allow-origin']).not.toBe('*');
  });
});

describe('error handler', () => {
  function respond(error, nodeEnv) {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = nodeEnv;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      errorHandler(error, { path: '/x', method: 'GET' }, res, () => {});
    } finally {
      process.env.NODE_ENV = original;
      console.error.mockRestore();
    }
    return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
  }

  it('hides unexpected error messages and stack traces in production', () => {
    const { status, body } = respond(new Error('relation "secret_table" does not exist'), 'production');

    expect(status).toBe(500);
    expect(body).toEqual({ error: 'Internal server error' });
  });

  it('keeps messages of errors raised deliberately with a status code', () => {
    const error = Object.assign(new Error('Model artifact not found'), { statusCode: 503 });

    expect(respond(error, 'production')).toEqual({ status: 503, body: { error: 'Model artifact not found' } });
  });

  it('shows the message and stack in development', () => {
    const { body } = respond(new Error('relation "secret_table" does not exist'), 'development');

    expect(body.error).toMatch(/secret_table/);
    expect(body.stack).toEqual(expect.any(String));
  });

  it('hides constraint details outside development', () => {
    const error = Object.assign(new Error('duplicate key'), { code: '23505', detail: 'Key (id)=(1) already exists.' });

    expect(respond(error, 'production')).toEqual({ status: 409, body: { error: 'Conflict - Record already exists', details: undefined } });
  });
});
