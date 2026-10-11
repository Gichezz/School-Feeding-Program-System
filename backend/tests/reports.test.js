const app = require('../src/app');
const { api } = require('./helpers/auth');

const asAdmin = api(app);
const { pool, SCHOOL_ID, resetDatabase } = require('./helpers/fixtures');

beforeAll(async () => {
  await resetDatabase();
  await asAdmin.post('/api/attendance').send({
    school_id: SCHOOL_ID,
    attendance_date: '05-10-2026',
    total_registered: 100,
    total_present: 95,
    total_absent: 5,
  });
  await asAdmin.post('/api/meals').send({
    school_id: SCHOOL_ID,
    distribution_date: '05-10-2026',
    meals_prepared: 100,
    meals_served: 92,
  });
});
afterAll(() => pool.end());

const october = `startDate=01-10-2026&endDate=31-10-2026&school_id=${SCHOOL_ID}`;

describe('GET /api/reports/dashboard', () => {
  it('summarises attendance, meals and sync state for a date range', async () => {
    const res = await asAdmin.get(`/api/reports/dashboard?${october}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.attendance).toMatchObject({ total_registered: 100, total_present: 95, record_count: 1 });
    expect(res.body.summary.meals).toMatchObject({ total_prepared: 100, total_served: 92, difference: 8 });
    expect(res.body.summary.sync).toMatchObject({ pending_operations: 0, unresolved_conflicts: 0 });
  });

  it('includes all records when no range is given', async () => {
    const res = await asAdmin.get('/api/reports/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.summary.attendance.record_count).toBe(2);
  });

  it('rejects an invalid date with 400', async () => {
    const res = await asAdmin.get('/api/reports/dashboard?startDate=2026-10-01&endDate=2026-10-31');

    expect(res.status).toBe(400);
  });
});

describe('attendance and meal reports', () => {
  it('returns attendance records in the range', async () => {
    const res = await asAdmin.get(`/api/reports/attendance?${october}`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('returns meal records in the range', async () => {
    const res = await asAdmin.get(`/api/reports/meals?${october}`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it.each(['/api/reports/attendance/trend', '/api/reports/meals/trend'])('%s returns a trend series', async (path) => {
    const res = await asAdmin.get(`${path}?${october}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.trend)).toBe(true);
  });
});
