const app = require('../src/app');
const { api, USERS } = require('./helpers/auth');
const { pool, resetDatabase, SCHOOL_ID, syncOperation } = require('./helpers/fixtures');

/**
 * The three roles: feeding teachers record (school_staff), programme officers check and
 * decide for their sub-county, system administrators run the system and can read the
 * programme's records but decide nothing. And enrolment verification, which sets the
 * food a school can request.
 */

const asAdmin = api(app);
const asOfficer = api(app, 'officer');
const asStaff = api(app, 'staff');
const SUB_COUNTY = 'Mfano Sub-County';
const OTHER_SCHOOL_ID = '11111111-1111-1111-1111-111111111112';

let termId;

beforeEach(async () => {
  await resetDatabase();
  // The test clock is Thursday 8 October 2026: Term 3 of 2026
  termId = (await pool.query('SELECT id FROM school_terms WHERE year = 2026 AND term = 3')).rows[0].id;
});
afterAll(() => pool.end());

function enrolment(overrides = {}) {
  return { schoolId: SCHOOL_ID, termId, class: 'Grade 4', sex: 'F', learners: 52, ...overrides };
}

async function enter(...rows) {
  const operations = rows.map((row, i) => syncOperation(`op-enrol-${i}-${row.class}-${row.sex}`, 'enrolment', 'create', row, 0));
  const res = await asAdmin.post('/api/sync').send({ clientId: 'device-a', operations });
  expect(res.body.results.every((r) => r.status === 'synced')).toBe(true);
}

const schoolIn = (body, id = SCHOOL_ID) => body.schools.find((s) => s.schoolId === id);

describe('system administrators read but do not decide', () => {
  it.each([
    ['check a flag', (a) => a.post('/api/review/flags/11111111-1111-1111-1111-111111111111/check').send({ note: 'x' })],
    ['decide a weekly review', (a) => a.put(`/api/review-lists/05-10-2026/decisions/${SCHOOL_ID}`).send({ status: 'explained', note: 'x' })],
    ['apply a held record', (a) => a.post('/api/sync/held/11111111-1111-1111-1111-111111111111/apply')],
    ['discard a held record', (a) => a.post('/api/sync/held/11111111-1111-1111-1111-111111111111/discard')],
    ['resolve a conflict', (a) => a.post('/api/sync/conflicts/11111111-1111-1111-1111-111111111111/resolve').send({ resolution: 'keep_local' })],
    ['verify enrolment', (a) => a.post(`/api/enrolment/${SCHOOL_ID}/${termId}/verify`)],
  ])('cannot %s', async (_, call) => {
    expect((await call(asAdmin)).status).toBe(403);
  });

  it('can read every sub-county’s flags, held records, analytics and enrolment', async () => {
    expect((await asAdmin.get('/api/review/flags')).status).toBe(200);
    expect((await asAdmin.get('/api/sync/held')).status).toBe(200);
    expect((await asAdmin.get(`/api/analytics/term?subCounty=${encodeURIComponent(SUB_COUNTY)}`)).status).toBe(200);
    expect((await asAdmin.get(`/api/enrolment?subCounty=${encodeURIComponent(SUB_COUNTY)}`)).status).toBe(200);
  });
});

describe('enrolment verification', () => {
  it("lists the sub-county's schools with their enrolment and whether it is checked", async () => {
    await enter(enrolment(), enrolment({ sex: 'M', learners: 48 }));

    const res = await asOfficer.get('/api/enrolment');

    expect(res.status).toBe(200);
    expect(res.body.term).toMatchObject({ id: termId, label: 'Term 3 2026' });
    expect(schoolIn(res.body)).toMatchObject({ learners: 100, status: 'not_verified', verifiedAt: null });
    expect(schoolIn(res.body).classes).toHaveLength(2);
    expect(schoolIn(res.body, OTHER_SCHOOL_ID)).toMatchObject({ status: 'not_entered', learners: 0 });
  });

  it('verifies a school’s enrolment for the term, as a new version in its history', async () => {
    await enter(enrolment(), enrolment({ sex: 'M', learners: 48 }));

    const res = await asOfficer.post(`/api/enrolment/${SCHOOL_ID}/${termId}/verify`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ verified: 2, verifiedBy: USERS.officer.name });
    const rows = (await pool.query('SELECT verified_by, version FROM enrolment WHERE school_id = $1', [SCHOOL_ID])).rows;
    expect(rows.every((r) => r.verified_by === USERS.officer.id && r.version === 2)).toBe(true);
    const history = (await pool.query("SELECT values, changed_by FROM record_history WHERE entity_type = 'enrolment' AND version = 2")).rows;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ changed_by: USERS.officer.id, values: expect.objectContaining({ verified: true }) });
    const list = (await asOfficer.get('/api/enrolment')).body;
    expect(schoolIn(list)).toMatchObject({ status: 'verified', verifiedBy: USERS.officer.name });
  });

  it("reaches the school's devices, and a later change on the device needs checking again", async () => {
    await enter(enrolment());
    await asOfficer.post(`/api/enrolment/${SCHOOL_ID}/${termId}/verify`);

    const download = (await asStaff.get(`/api/sync/changes?schoolId=${SCHOOL_ID}`)).body;
    expect(download.enrolment).toEqual([expect.objectContaining({ verified: true, version: 2 })]);

    // The feeding teacher corrects the number on the verified version
    const edit = await asAdmin.post('/api/sync').send({
      clientId: 'device-a',
      operations: [syncOperation('op-edit', 'enrolment', 'update', enrolment({ learners: 55 }), 2)],
    });
    expect(edit.body.results[0].status).toBe('synced');
    expect(schoolIn((await asOfficer.get('/api/enrolment')).body)).toMatchObject({ status: 'not_verified', learners: 55 });
  });

  it('says when only some classes changed since they were checked', async () => {
    await enter(enrolment(), enrolment({ sex: 'M', learners: 48 }));
    await asOfficer.post(`/api/enrolment/${SCHOOL_ID}/${termId}/verify`);
    await asAdmin.post('/api/sync').send({
      clientId: 'device-a',
      operations: [syncOperation('op-edit', 'enrolment', 'update', enrolment({ learners: 50 }), 2)],
    });

    const school = schoolIn((await asOfficer.get('/api/enrolment')).body);

    expect(school.status).toBe('changed');
    expect(school.classes.filter((c) => !c.verified)).toHaveLength(1);
  });

  it('refuses a school that has not entered its enrolment, and schools in other sub-counties', async () => {
    expect((await asOfficer.post(`/api/enrolment/${SCHOOL_ID}/${termId}/verify`)).status).toBe(400);

    await enter(enrolment());
    await pool.query("UPDATE schools SET sub_county = 'Another Sub-County' WHERE id = $1", [SCHOOL_ID]);
    expect((await asOfficer.post(`/api/enrolment/${SCHOOL_ID}/${termId}/verify`)).status).toBe(404);
    expect(schoolIn((await asOfficer.get('/api/enrolment')).body)).toBeUndefined();
  });

  it('is not for feeding teachers', async () => {
    expect((await asStaff.get('/api/enrolment')).status).toBe(403);
    expect((await asStaff.post(`/api/enrolment/${SCHOOL_ID}/${termId}/verify`)).status).toBe(403);
  });
});

describe('programme officer accounts', () => {
  const officer = { name: 'Wanjiru Kamau', email: 'wanjiru@example.org', role: 'programme_officer', password: 'county-ledger-2026' };

  it('are created with the sub-county they cover', async () => {
    const res = await asAdmin.post('/api/users').send({ ...officer, subCounty: SUB_COUNTY });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'programme_officer', subCounty: SUB_COUNTY, schoolId: null });
  });

  it('need a sub-county the programme has schools in', async () => {
    expect((await asAdmin.post('/api/users').send(officer)).status).toBe(400);
    expect((await asAdmin.post('/api/users').send({ ...officer, subCounty: 'Nowhere Sub-County' })).status).toBe(400);
  });

  it('keep their sub-county only while they are officers', async () => {
    const created = (await asAdmin.post('/api/users').send({ ...officer, subCounty: SUB_COUNTY })).body.user;

    const toAdmin = await asAdmin.patch(`/api/users/${created.id}`).send({ role: 'admin' });
    expect(toAdmin.body.user).toMatchObject({ role: 'admin', subCounty: null });

    expect((await asAdmin.patch(`/api/users/${created.id}`).send({ role: 'programme_officer' })).status).toBe(400);
    const back = await asAdmin.patch(`/api/users/${created.id}`).send({ role: 'programme_officer', subCounty: SUB_COUNTY });
    expect(back.body.user).toMatchObject({ role: 'programme_officer', subCounty: SUB_COUNTY });
  });
});

describe('delivery witness', () => {
  const delivery = (overrides = {}) => ({
    id: 'eeeeeeee-eeee-4eee-8eee-000000000001', schoolId: SCHOOL_ID, movementDate: '05-10-2026', commodity: 'cereals',
    kind: 'delivery', quantityKg: 500, reference: 'DN-2026-114', ...overrides,
  });

  it("keeps who witnessed a delivery and sends it to the school's devices", async () => {
    const res = await asAdmin.post('/api/sync').send({
      clientId: 'device-a', operations: [syncOperation('op-w', 'stockMovement', 'create', delivery({ witness: 'Mary Achieng' }), 0)],
    });
    expect(res.body.results[0].status).toBe('synced');

    expect((await pool.query('SELECT witness FROM stock_movements')).rows[0].witness).toBe('Mary Achieng');
    const download = (await asStaff.get(`/api/sync/changes?schoolId=${SCHOOL_ID}`)).body;
    expect(download.stockMovements[0]).toMatchObject({ reference: 'DN-2026-114', witness: 'Mary Achieng' });
  });

  it('is optional, and refuses a name that is too long', async () => {
    const without = await asAdmin.post('/api/sync').send({
      clientId: 'device-a', operations: [syncOperation('op-1', 'stockMovement', 'create', delivery(), 0)],
    });
    expect(without.body.results[0].status).toBe('synced');

    const tooLong = await asAdmin.post('/api/sync').send({
      clientId: 'device-a',
      operations: [syncOperation('op-2', 'stockMovement', 'create', delivery({ id: 'eeeeeeee-eeee-4eee-8eee-000000000002', witness: 'x'.repeat(121) }), 0)],
    });
    expect(tooLong.body.results?.[0]?.status ?? tooLong.status).not.toBe('synced');
  });
});
