const app = require('../src/app');
const { api } = require('./helpers/auth');
const { pool, resetDatabase, SCHOOL_ID, syncOperation } = require('./helpers/fixtures');

const asAdmin = api(app);
const asStaff = api(app, 'staff');
const asOfficer = api(app, 'officer');

// Seeded in the officer's sub-county
const SAME_SUB_COUNTY_SCHOOL = '11111111-1111-1111-1111-111111111112';
const ELSEWHERE_SCHOOL = '33333333-3333-4333-8333-333333333333';

beforeEach(async () => {
  await resetDatabase();
  await pool.query(
    "INSERT INTO schools (id, name, sub_county) VALUES ($1, 'Elsewhere Primary', 'Another Sub-County')",
    [ELSEWHERE_SCHOOL]
  );
});
afterAll(() => pool.end());

function feeding(date, overrides = {}) {
  return {
    schoolId: SCHOOL_ID, feedingDate: date, feedingHappened: true,
    learnersFed: 400, cerealsKg: 60, pulsesKg: 16, ...overrides,
  };
}

function sync(operations) {
  return asAdmin.post('/api/sync').send({ clientId: 'device-a', operations });
}

function changes(since, { as = asStaff, schoolId = SCHOOL_ID } = {}) {
  const query = new URLSearchParams({ schoolId, ...(since !== undefined && { since }) });
  return as.get(`/api/sync/changes?${query}`);
}

describe('GET /api/sync/changes', () => {
  it('sends a new device everything for its school, with the school settings and calendar', async () => {
    await sync([
      syncOperation('op-1', 'dailyFeeding', 'create', feeding('06-10-2026'), 0),
      syncOperation('op-2', 'stockMovement', 'create', {
        id: 'eeeeeeee-eeee-4eee-8eee-000000000001', schoolId: SCHOOL_ID, movementDate: '05-10-2026',
        commodity: 'cereals', kind: 'delivery', quantityKg: 500, reference: 'DN-2026-114',
      }, 0),
    ]);

    const res = await changes();

    expect(res.status).toBe(200);
    expect(res.body.cursor).toMatch(/^\d+$/);
    expect(res.body.school).toMatchObject({
      id: SCHOOL_ID, subCounty: 'Mfano Sub-County', programmeType: 'in_kind',
      ration: { cereals: 150, pulses: 40, oil: 5, salt: 2 },
    });
    expect(res.body.terms).toHaveLength(9);
    expect(res.body.terms).toContainEqual(expect.objectContaining({ year: 2026, term: 3, opensOn: '24-08-2026', closesOn: '23-10-2026' }));
    expect(res.body.calendarEvents).toContainEqual(expect.objectContaining({ kind: 'public_holiday', name: 'Mashujaa Day', startsOn: '20-10-2026' }));
    expect(res.body.dailyFeeding).toEqual([expect.objectContaining({ feedingDate: '06-10-2026', learnersFed: 400, cerealsKg: 60, version: 1 })]);
    expect(res.body.stockMovements).toEqual([expect.objectContaining({ kind: 'delivery', quantityKg: 500, movementDate: '05-10-2026' })]);
    expect(res.body.enrolment).toEqual([]);
  });

  it('sends only what changed since the cursor, including edits', async () => {
    const created = await sync([syncOperation('op-1', 'dailyFeeding', 'create', feeding('06-10-2026'), 0)]);
    const first = await changes();

    await sync([
      { ...syncOperation('op-2', 'dailyFeeding', 'update', feeding('06-10-2026', { learnersFed: 395 }), 1), baseRecordId: created.body.results[0].recordId },
      syncOperation('op-3', 'dailyFeeding', 'create', feeding('07-10-2026'), 0),
    ]);
    const second = await changes(first.body.cursor);
    const third = await changes(second.body.cursor);

    expect(second.body.dailyFeeding.map((r) => [r.feedingDate, r.learnersFed, r.version])).toEqual([
      ['06-10-2026', 395, 2],
      ['07-10-2026', 400, 1],
    ]);
    expect(third.body.dailyFeeding).toEqual([]);
  });

  it('does not lose a save that commits after a later save', async () => {
    // A save still in progress...
    const slow = await pool.connect();
    try {
      await slow.query('BEGIN');
      await slow.query(
        `INSERT INTO daily_feeding (school_id, feeding_date, feeding_happened, learners_fed, cereals_kg, pulses_kg)
         VALUES ($1, '2026-10-05', true, 380, 57, 15.2)`,
        [SCHOOL_ID]
      );
      // ...while a later save commits first
      await sync([syncOperation('op-1', 'dailyFeeding', 'create', feeding('06-10-2026'), 0)]);
      const during = await changes();

      await slow.query('COMMIT');
      const after = await changes(during.body.cursor);

      const seen = [...during.body.dailyFeeding, ...after.body.dailyFeeding].map((r) => r.feedingDate).sort();
      expect(seen).toEqual(['05-10-2026', '06-10-2026']);
    } finally {
      slow.release();
    }
  });

  it('lets programme officers download schools in their sub-county only', async () => {
    expect((await changes(undefined, { as: asOfficer, schoolId: SAME_SUB_COUNTY_SCHOOL })).status).toBe(200);
    expect((await changes(undefined, { as: asOfficer, schoolId: ELSEWHERE_SCHOOL })).status).toBe(404);
  });

  it('keeps school staff to their own school', async () => {
    expect((await changes(undefined, { schoolId: SAME_SUB_COUNTY_SCHOOL })).status).toBe(404);
  });

  it('refuses a cursor that did not come from a download', async () => {
    expect((await changes('abc')).status).toBe(400);
  });
});
