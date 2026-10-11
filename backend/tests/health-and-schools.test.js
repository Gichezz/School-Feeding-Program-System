const app = require('../src/app');
const { api } = require('./helpers/auth');

const asAdmin = api(app);
const { pool, SCHOOL_ID, MISSING_ID, resetDatabase } = require('./helpers/fixtures');

beforeAll(resetDatabase);
afterAll(() => pool.end());

describe('GET /api/health', () => {
  it('reports the service and database as available', async () => {
    const res = await asAdmin.get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'connected' });
  });
});

describe('unknown routes', () => {
  it('return 404 JSON', async () => {
    const res = await asAdmin.get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});

describe('GET /api/schools', () => {
  it('lists the seeded school', async () => {
    const res = await asAdmin.get('/api/schools');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.schools[0]).toMatchObject({ id: SCHOOL_ID, name: 'Demo Primary School' });
  });

  it('returns a school by id', async () => {
    const res = await asAdmin.get(`/api/schools/${SCHOOL_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.school.id).toBe(SCHOOL_ID);
  });

  it('rejects a malformed id', async () => {
    const res = await asAdmin.get('/api/schools/not-a-uuid');

    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown school', async () => {
    const res = await asAdmin.get(`/api/schools/${MISSING_ID}`);

    expect(res.status).toBe(404);
  });
});
