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

  it('holds the cursor back while a save stays open across several downloads, then sends it once committed', async () => {
    // The cursor is the oldest transaction still running when the download starts, so it
    // cannot move past a save that has not committed: later saves may be sent again, but
    // nothing committed is ever skipped
    const slow = await pool.connect();
    try {
      await slow.query('BEGIN');
      await slow.query(
        `INSERT INTO daily_feeding (school_id, feeding_date, feeding_happened, learners_fed, cereals_kg, pulses_kg)
         VALUES ($1, '2026-10-01', true, 380, 57, 15.2)`,
        [SCHOOL_ID]
      );
      let cursor;
      const seen = [];
      for (const [i, date] of ['05-10-2026', '06-10-2026', '07-10-2026'].entries()) {
        await sync([syncOperation(`op-${i}`, 'dailyFeeding', 'create', feeding(date), 0)]);
        const download = (await changes(cursor)).body;
        seen.push(...download.dailyFeeding.map((r) => r.feedingDate));
        expect(download.dailyFeeding.map((r) => r.feedingDate)).not.toContain('01-10-2026');
        cursor = download.cursor;
      }

      await slow.query('COMMIT');
      const after = (await changes(cursor)).body;
      seen.push(...after.dailyFeeding.map((r) => r.feedingDate));

      expect([...new Set(seen)].sort()).toEqual(['01-10-2026', '05-10-2026', '06-10-2026', '07-10-2026']);
      // What was sent again is the same version, so a device applying it again changes nothing
      expect(after.dailyFeeding.every((r) => r.version === 1)).toBe(true);
    } finally {
      slow.release();
    }
  });

  it('gives a device that missed several edits only the latest version of each record', async () => {
    const created = await sync([syncOperation('op-1', 'dailyFeeding', 'create', feeding('06-10-2026'), 0)]);
    const old = (await changes()).body.cursor;
    const recordId = created.body.results[0].recordId;
    for (const [i, fed] of [395, 390, 388].entries()) {
      await sync([{ ...syncOperation(`op-edit-${i}`, 'dailyFeeding', 'update', feeding('06-10-2026', { learnersFed: fed }), i + 1), baseRecordId: recordId }]);
    }

    const caughtUp = (await changes(old)).body;

    expect(caughtUp.dailyFeeding).toEqual([expect.objectContaining({ feedingDate: '06-10-2026', learnersFed: 388, version: 4 })]);
  });

  it('never sends a save that was rolled back', async () => {
    const failed = await pool.connect();
    try {
      await failed.query('BEGIN');
      await failed.query(
        `INSERT INTO daily_feeding (school_id, feeding_date, feeding_happened, learners_fed, cereals_kg, pulses_kg)
         VALUES ($1, '2026-10-02', true, 380, 57, 15.2)`,
        [SCHOOL_ID]
      );
      await failed.query('ROLLBACK');
    } finally {
      failed.release();
    }

    expect((await changes()).body.dailyFeeding).toEqual([]);
  });

  it('gives the same answer when a device downloads twice from the same cursor', async () => {
    const first = (await changes()).body;
    await sync([syncOperation('op-1', 'dailyFeeding', 'create', feeding('06-10-2026'), 0)]);

    const once = (await changes(first.cursor)).body;
    const again = (await changes(first.cursor)).body;

    expect(again.dailyFeeding).toEqual(once.dailyFeeding);
    expect(once.dailyFeeding).toHaveLength(1);
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

describe('decisions on held records in downloads', () => {
  function delivery(id, quantityKg = 500) {
    return { id, schoolId: SCHOOL_ID, movementDate: '05-10-2026', commodity: 'cereals', kind: 'delivery', quantityKg, reference: 'DN-2026-114' };
  }
  const FIRST = 'eeeeeeee-0000-4000-8000-000000000001';
  const SECOND = 'eeeeeeee-0000-4000-8000-000000000002';

  async function heldDuplicate() {
    await asAdmin.post('/api/sync').send({ clientId: 'device-a', operations: [syncOperation('op-1', 'stockMovement', 'create', delivery(FIRST), 0)] });
    await asAdmin.post('/api/sync').send({ clientId: 'device-b', operations: [syncOperation('op-2', 'stockMovement', 'create', delivery(SECOND, 300), 0)] });
    return (await asAdmin.get('/api/sync/held')).body.held[0].id;
  }

  it('tells the school\'s devices a duplicate was discarded, once', async () => {
    const heldId = await heldDuplicate();
    const before = (await asStaff.get(`/api/sync/changes?schoolId=${SCHOOL_ID}`)).body;

    await asOfficer.post(`/api/sync/held/${heldId}/discard`);
    const after = (await asStaff.get(`/api/sync/changes?schoolId=${SCHOOL_ID}&since=${before.cursor}`)).body;
    const later = (await asStaff.get(`/api/sync/changes?schoolId=${SCHOOL_ID}&since=${after.cursor}`)).body;

    expect(before.heldDecisions).toEqual([]);
    expect(after.heldDecisions).toEqual([{ operationId: 'op-2', entityType: 'stockMovement', decision: 'discarded', id: SECOND, record: null }]);
    expect(after.stockMovements).toEqual([]);
    expect(later.heldDecisions).toEqual([]);
  });

  it('sends an applied entry with the decision', async () => {
    const heldId = await heldDuplicate();
    const before = (await asStaff.get(`/api/sync/changes?schoolId=${SCHOOL_ID}`)).body;

    await asOfficer.post(`/api/sync/held/${heldId}/apply`);
    const after = (await asStaff.get(`/api/sync/changes?schoolId=${SCHOOL_ID}&since=${before.cursor}`)).body;

    expect(after.heldDecisions).toEqual([expect.objectContaining({ operationId: 'op-2', decision: 'applied', id: SECOND })]);
    expect(after.stockMovements.map((m) => m.id)).toEqual([SECOND]);
  });
});

describe('practice terms in downloads', () => {
  it("sends a practice term with its label, and real terms with their usual name", async () => {
    await pool.query(
      `INSERT INTO school_terms (year, term, opens_on, closes_on, label, practice)
       VALUES (2026, NULL, '2026-10-26', '2026-12-18', 'Practice term (demonstration)', true)`
    );

    const { terms } = (await asStaff.get(`/api/sync/changes?schoolId=${SCHOOL_ID}`)).body;

    expect(terms.find((t) => t.practice)).toMatchObject({ term: null, label: 'Practice term (demonstration)', opensOn: '26-10-2026' });
    expect(terms.find((t) => t.year === 2026 && t.term === 3)).toMatchObject({ label: 'Term 3 2026', practice: false });
  });

  it('refuses a practice term without a label, and a numbered term marked practice', async () => {
    const insert = (term, label, practice) => pool.query(
      `INSERT INTO school_terms (year, term, opens_on, closes_on, label, practice) VALUES (2026, $1, '2026-10-26', '2026-12-18', $2, $3)`,
      [term, label, practice]
    );

    await expect(insert(null, null, true)).rejects.toThrow(/school_terms_practice/);
    await expect(insert(null, 'A label', false)).rejects.toThrow(/school_terms_practice/);
  });
});
