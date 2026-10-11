const request = require('supertest');
const app = require('../src/app');
const { pool, SCHOOL_ID, MISSING_ID, resetDatabase } = require('./helpers/fixtures');

beforeEach(resetDatabase);
afterAll(() => pool.end());

function attendanceBody(overrides = {}) {
  return {
    school_id: SCHOOL_ID,
    attendance_date: '05-10-2026',
    total_registered: 100,
    total_present: 95,
    total_absent: 5,
    ...overrides,
  };
}

function mealBody(overrides = {}) {
  return {
    school_id: SCHOOL_ID,
    distribution_date: '05-10-2026',
    meals_prepared: 100,
    meals_served: 92,
    ...overrides,
  };
}

describe('attendance records', () => {
  it('creates a record at version 1 and returns DD-MM-YYYY dates', async () => {
    const res = await request(app).post('/api/attendance').send(attendanceBody());

    expect(res.status).toBe(201);
    expect(res.body.attendance).toMatchObject({
      school_id: SCHOOL_ID,
      attendance_date: '05-10-2026',
      total_present: 95,
      version: 1,
    });
  });

  it('lists records filtered by school and date', async () => {
    await request(app).post('/api/attendance').send(attendanceBody());

    const res = await request(app).get(`/api/attendance?school_id=${SCHOOL_ID}&date=05-10-2026`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.attendance[0]).toMatchObject({ attendance_date: '05-10-2026', school_name: 'Demo Primary School' });
  });

  it('returns a record by id, 400 for a malformed id and 404 for an unknown id', async () => {
    const created = await request(app).post('/api/attendance').send(attendanceBody());

    const found = await request(app).get(`/api/attendance/${created.body.attendance.id}`);
    const malformed = await request(app).get('/api/attendance/abc');
    const missing = await request(app).get(`/api/attendance/${MISSING_ID}`);

    expect(found.status).toBe(200);
    expect(found.body.attendance.total_present).toBe(95);
    expect(malformed.status).toBe(400);
    expect(missing.status).toBe(404);
  });

  it.each([
    ['missing fields', { total_present: undefined }],
    ['an invalid date format', { attendance_date: '2026-10-05' }],
    ['negative counts', { total_absent: -1 }],
    ['present + absent above registered', { total_present: 99, total_absent: 5 }],
    ['present + absent below registered', { total_present: 90, total_absent: 5 }],
    ['a malformed school id', { school_id: 'abc' }],
  ])('rejects %s with 400', async (_, overrides) => {
    const res = await request(app).post('/api/attendance').send(attendanceBody(overrides));

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects a second record for the same school and date with 409', async () => {
    await request(app).post('/api/attendance').send(attendanceBody());

    const res = await request(app).post('/api/attendance').send(attendanceBody({ total_present: 90, total_absent: 10 }));

    expect(res.status).toBe(409);
  });

  it('rejects a non-JSON body with 400', async () => {
    const res = await request(app).post('/api/attendance').set('Content-Type', 'text/plain').send('hello');

    expect(res.status).toBe(400);
  });
});

describe('meal distributions', () => {
  it('creates a record at version 1', async () => {
    const res = await request(app).post('/api/meals').send(mealBody());

    expect(res.status).toBe(201);
    expect(res.body.meal).toMatchObject({
      school_id: SCHOOL_ID,
      distribution_date: '05-10-2026',
      meals_served: 92,
      version: 1,
    });
  });

  it('lists records for the school, including seed data', async () => {
    await request(app).post('/api/meals').send(mealBody());

    const res = await request(app).get(`/api/meals?school_id=${SCHOOL_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  it.each([
    ['missing fields', { meals_served: undefined }],
    ['an invalid date format', { distribution_date: '5/10/2026' }],
    ['negative counts', { meals_prepared: -5 }],
    ['more meals served than prepared', { meals_served: 101 }],
  ])('rejects %s with 400', async (_, overrides) => {
    const res = await request(app).post('/api/meals').send(mealBody(overrides));

    expect(res.status).toBe(400);
  });

  it('rejects a second record for the same school and date with 409', async () => {
    await request(app).post('/api/meals').send(mealBody());

    const res = await request(app).post('/api/meals').send(mealBody());

    expect(res.status).toBe(409);
  });
});
