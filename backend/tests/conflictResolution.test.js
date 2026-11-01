const app = require('../src/app');
const { api } = require('./helpers/auth');
const { pool, resetDatabase, SCHOOL_ID, syncOperation } = require('./helpers/fixtures');

const asAdmin = api(app);
const asStaff = api(app, 'staff');
const asOfficer = api(app, 'officer');

const OFFICER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
const ELSEWHERE_SCHOOL = '33333333-3333-4333-8333-333333333333';

beforeEach(async () => {
  await resetDatabase();
  await pool.query(
    "INSERT INTO schools (id, name, sub_county) VALUES ($1, 'Elsewhere Primary', 'Another Sub-County')",
    [ELSEWHERE_SCHOOL]
  );
});
afterAll(() => pool.end());

function feeding(overrides = {}) {
  return {
    schoolId: SCHOOL_ID, feedingDate: '06-10-2026', feedingHappened: true, learnersPresent: 410,
    learnersFed: 400, cerealsKg: 60, pulsesKg: 16, ...overrides,
  };
}

function sync(clientId, operations) {
  return asAdmin.post('/api/sync').send({ clientId, operations });
}

/** Device A records the day first; device B's different numbers for it become a conflict. */
async function sameDayConflict(schoolId = SCHOOL_ID) {
  await sync('device-a', [syncOperation(`a-${schoolId}`, 'dailyFeeding', 'create', feeding({ schoolId }), 0)]);
  const res = await sync('device-b', [syncOperation(`b-${schoolId}`, 'dailyFeeding', 'create', feeding({ schoolId, learnersFed: 380, cerealsKg: 57 }), 0)]);
  return res.body.results[0].conflictId;
}

function resolve(conflictId, body, as = asOfficer) {
  return as.post(`/api/sync/conflicts/${conflictId}/resolve`).send({ clientId: 'officer-laptop', ...body });
}

async function feedingRow() {
  return (await pool.query('SELECT learners_fed, cereals_kg, version, updated_by FROM daily_feeding')).rows[0];
}

describe('resolving a daily feeding conflict', () => {
  it('records the school with the conflict', async () => {
    const conflictId = await sameDayConflict();

    const row = (await pool.query('SELECT school_id, entity_type FROM conflicts WHERE conflict_id = $1', [conflictId])).rows[0];
    expect(row).toEqual({ school_id: SCHOOL_ID, entity_type: 'daily_feeding' });
  });

  it("lets a programme officer keep the device's version, as a new version in the record's history", async () => {
    const conflictId = await sameDayConflict();

    const res = await resolve(conflictId, { resolution: 'keep_local' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ resolution: 'keep_local', version: 2 });
    expect(await feedingRow()).toEqual({ learners_fed: 380, cereals_kg: '57.00', version: 2, updated_by: OFFICER_ID });
    const conflict = (await pool.query('SELECT status, resolved_by, resolved_xid FROM conflicts')).rows[0];
    expect(conflict).toMatchObject({ status: 'resolved', resolved_by: OFFICER_ID });
    expect(conflict.resolved_xid).not.toBeNull();
    const history = (await pool.query("SELECT version FROM record_history WHERE entity_type = 'daily_feeding' ORDER BY version")).rows;
    expect(history.map((h) => h.version)).toEqual([1, 2]);
    // The resolver's own decision is not flagged for review
    expect((await pool.query('SELECT count(*)::int AS n FROM record_flags WHERE version = 2')).rows[0].n).toBe(0);
  });

  it("keeps the server's version unchanged", async () => {
    const conflictId = await sameDayConflict();

    const res = await resolve(conflictId, { resolution: 'keep_server' });

    expect(res.status).toBe(200);
    expect(await feedingRow()).toMatchObject({ learners_fed: 400, version: 1 });
  });

  it('applies merged values, checked like any record', async () => {
    const conflictId = await sameDayConflict();
    const merged = {
      feedingHappened: true, learnersPresent: 410, learnersFed: 390, cerealsKg: 58.5, pulsesKg: 15.6, reasonCode: null, note: null,
    };

    const bad = await resolve(conflictId, { resolution: 'merge', values: { ...merged, learnersFed: 420 } });
    const good = await resolve(conflictId, { resolution: 'merge', values: merged });

    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/cannot exceed learners present/);
    expect(good.status).toBe(200);
    expect(await feedingRow()).toMatchObject({ learners_fed: 390, cereals_kg: '58.50', version: 2 });
  });

  it('refuses a decision when the record changed again since the conflict', async () => {
    const conflictId = await sameDayConflict();
    const recordId = (await pool.query('SELECT id FROM daily_feeding')).rows[0].id;
    await sync('device-a', [{ ...syncOperation('a-2', 'dailyFeeding', 'update', feeding({ learnersFed: 405, cerealsKg: 60.75 }), 1), baseRecordId: recordId }]);

    const res = await resolve(conflictId, { resolution: 'keep_local' });

    expect(res.status).toBe(409);
    expect(await feedingRow()).toMatchObject({ learners_fed: 405, version: 2 });
  });

  it('is sent to the school’s devices with the record as the server now has it', async () => {
    const conflictId = await sameDayConflict();
    const before = await asStaff.get(`/api/sync/changes?schoolId=${SCHOOL_ID}`);
    await resolve(conflictId, { resolution: 'keep_local' });

    const after = await asStaff.get(`/api/sync/changes?schoolId=${SCHOOL_ID}&since=${before.body.cursor}`);

    expect(before.body.resolvedConflicts).toEqual([]);
    expect(after.body.resolvedConflicts).toEqual([{
      conflictId, operationId: `b-${SCHOOL_ID}`, entityType: 'dailyFeeding', resolution: 'keep_local',
      record: expect.objectContaining({ learnersFed: 380, version: 2 }),
    }]);
  });
});

describe('resolving an enrolment conflict', () => {
  it('merges the agreed number of learners', async () => {
    const termId = (await pool.query('SELECT id FROM school_terms WHERE year = 2026 AND term = 3')).rows[0].id;
    const entry = { schoolId: SCHOOL_ID, termId, class: 'Grade 4', sex: 'F', learners: 52 };
    await sync('device-a', [syncOperation('e-a', 'enrolment', 'create', entry, 0)]);
    const res = await sync('device-b', [syncOperation('e-b', 'enrolment', 'create', { ...entry, learners: 55 }, 0)]);

    await resolve(res.body.results[0].conflictId, { resolution: 'merge', values: { learners: 54 } });

    expect((await pool.query('SELECT learners, version FROM enrolment')).rows[0]).toEqual({ learners: 54, version: 2 });
  });
});

describe('who sees and resolves which conflicts', () => {
  it('keeps programme officers to the schools in their sub-county', async () => {
    const elsewhere = await sameDayConflict(ELSEWHERE_SCHOOL);

    const res = await resolve(elsewhere, { resolution: 'keep_local' });

    expect(res.status).toBe(404);
    expect((await asAdmin.post(`/api/sync/conflicts/${elsewhere}/resolve`).send({ resolution: 'keep_local' })).status).toBe(200);
  });

  it('does not let school staff resolve conflicts', async () => {
    const conflictId = await sameDayConflict();

    expect((await resolve(conflictId, { resolution: 'keep_local' }, asStaff)).status).toBe(403);
  });

  it('lists only the conflicts of the schools each person may see', async () => {
    const own = await sameDayConflict();
    const elsewhere = await sameDayConflict(ELSEWHERE_SCHOOL);
    const ids = async (as) => (await as.get('/api/sync/conflicts')).body.conflicts.map((c) => c.conflict_id).sort();

    expect(await ids(asStaff)).toEqual([own]);
    expect(await ids(asOfficer)).toEqual([own]);
    expect(await ids(asAdmin)).toEqual([own, elsewhere].sort());
    expect((await asOfficer.get(`/api/sync/conflicts/${elsewhere}`)).status).toBe(404);
  });
});

describe('the conflicts list', () => {
  it('names the school, and the term for enrolment', async () => {
    const termId = (await pool.query('SELECT id FROM school_terms WHERE year = 2026 AND term = 3')).rows[0].id;
    const count = (learners) => ({ schoolId: SCHOOL_ID, termId, class: 'Grade 4', sex: 'F', learners });
    await sameDayConflict();
    await sync('device-a', [syncOperation('e-a', 'enrolment', 'create', count(30), 0)]);
    await sync('device-b', [syncOperation('e-b', 'enrolment', 'create', count(32), 0)]);

    const res = await asOfficer.get('/api/sync/conflicts?status=unresolved');

    const byType = Object.fromEntries(res.body.conflicts.map((c) => [c.entity_type, c]));
    expect(byType.daily_feeding).toMatchObject({ school_name: 'Demo Primary School', term_label: null });
    expect(byType.enrolment).toMatchObject({ school_name: 'Demo Primary School', term_label: 'Term 3 2026' });
  });
});
