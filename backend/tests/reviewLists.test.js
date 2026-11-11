jest.mock('../src/services/scoringClient', () => {
  const actual = jest.requireActual('../src/services/scoringClient');
  return { ...actual, requestScores: jest.fn() };
});

const app = require('../src/app');
const { api, USERS } = require('./helpers/auth');
const { pool, resetDatabase, SCHOOL_ID } = require('./helpers/fixtures');
const { requestScores, ScoringServiceUnavailableError } = require('../src/services/scoringClient');

// The test clock is Thursday 8 October 2026; the current week starts Monday 5 October
const asAdmin = api(app);
const asOfficer = api(app, 'officer');
const asStaff = api(app, 'staff');

const SUB_COUNTY = 'Mfano Sub-County';
const OTHER_SCHOOL_ID = '11111111-1111-1111-1111-111111111112';
const BATCH_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

let termId;

beforeEach(async () => {
  await resetDatabase();
  requestScores.mockReset();
  termId = (await pool.query('SELECT id FROM school_terms WHERE year = 2026 AND term = 3')).rows[0].id;
});
afterAll(() => pool.end());

async function addFeeding(schoolId, date, { fed = 400, cereals = 60, capturedAt = '2026-10-06T07:30:00Z', batch = null } = {}) {
  if (batch) await pool.query('INSERT INTO sync_batches (id, school_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [batch, schoolId]);
  await pool.query(
    `INSERT INTO daily_feeding (school_id, feeding_date, feeding_happened, learners_present, learners_fed, cereals_kg, pulses_kg,
                                captured_at, received_at, sync_batch_id)
     VALUES ($1, $2, true, $3, $3, $4, 12, $5, $5::timestamptz + interval '2 hours', $6)`,
    [schoolId, date, fed, cereals, capturedAt, batch]
  );
}

function scores(items, extra = {}) {
  return {
    week_start: '2026-10-05',
    mode: 'extended_isolation_forest',
    model: { method: 'extended_isolation_forest', settings: { n_estimators: 300, ndim: 2 }, fitted_on_rows: 480 },
    k: 1,
    items: items.map((schoolId, i) => ({
      school_id: schoolId, score: 2 - i, top_date: '2026-10-06', reasons: ['learners fed against similar schools nearby that day'],
      explanation: 'Needs review: learners fed was well above similar schools nearby.', rank: i + 1, listed: i === 0,
    })),
    rule_breaches: [{ school_id: items[0], date: '2026-10-06', rule: 'fed_exceeds_enrolled', detail: 'More learners fed than enrolled' }],
    notice: 'Ranks records for review; it does not decide anything.',
    ...extra,
  };
}

describe('scoring a week', () => {
  it("sends the sub-county's records up to the end of the week", async () => {
    await pool.query(
      "INSERT INTO enrolment (school_id, term_id, class, sex, learners) VALUES ($1, $2, 'Grade 1', 'F', 30), ($1, $2, 'Grade 1', 'M', 28)",
      [SCHOOL_ID, termId]
    );
    await addFeeding(SCHOOL_ID, '2026-10-06', { batch: BATCH_ID });
    await addFeeding(OTHER_SCHOOL_ID, '2026-10-06');
    await addFeeding(SCHOOL_ID, '2026-10-12');
    await pool.query(
      `INSERT INTO stock_movements (id, school_id, movement_date, commodity, kind, quantity_kg, reference)
       VALUES (gen_random_uuid(), $1, '2026-10-01', 'cereals', 'delivery', 500, 'DN-0412')`,
      [SCHOOL_ID]
    );
    await pool.query(
      "INSERT INTO stock_counts (id, school_id, count_date, commodity, counted_kg) VALUES (gen_random_uuid(), $1, '2026-10-07', 'cereals', 430)",
      [SCHOOL_ID]
    );
    requestScores.mockResolvedValue(scores([SCHOOL_ID, OTHER_SCHOOL_ID]));

    const res = await asOfficer.post('/api/review-lists/05-10-2026/run').send({ k: 1 });

    expect(res.status).toBe(201);
    const body = requestScores.mock.calls[0][0];
    expect(body.week_start).toBe('2026-10-05');
    expect(body.k).toBe(1);
    expect(body.schools).toHaveLength(4);
    expect(body.terms).toContainEqual(expect.objectContaining({ id: termId, year: 2026, term: 3 }));
    expect(body.enrolment).toEqual([{ school_id: SCHOOL_ID, term_id: termId, learners: 58 }]);
    // The next week's record is not sent
    expect(body.feeding.map((f) => f.date)).toEqual(['2026-10-06', '2026-10-06']);
    const own = body.feeding.find((f) => f.school_id === SCHOOL_ID);
    // Times in the schools' time zone; a record without a batch is a batch of its own
    expect(own).toEqual(expect.objectContaining({ captured_at: '2026-10-06T10:30:00', received_date: '2026-10-06', sync_batch_id: BATCH_ID, cereals_kg: 60 }));
    expect(body.feeding.find((f) => f.school_id === OTHER_SCHOOL_ID).sync_batch_id).toMatch(/^[0-9a-f-]{36}$/);
    // 500 delivered less 60 issued on 6 October
    expect(body.stock_counts).toEqual([{ school_id: SCHOOL_ID, date: '2026-10-07', commodity: 'cereals', counted_kg: 430, ledger_kg: 440 }]);
  });

  it('stores the ranking and returns it with school names and reasons', async () => {
    requestScores.mockResolvedValue(scores([SCHOOL_ID, OTHER_SCHOOL_ID]));

    await asOfficer.post('/api/review-lists/05-10-2026/run').send({ k: 1 });
    const res = await asOfficer.get('/api/review-lists/05-10-2026');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ subCounty: SUB_COUNTY, week: '05-10-2026', mode: 'extended_isolation_forest', k: 1, scoredBy: USERS.officer.name }));
    expect(res.body.items).toEqual([
      expect.objectContaining({ schoolId: SCHOOL_ID, schoolName: 'Demo Primary School', rank: 1, listed: true, topDate: '06-10-2026', decision: null }),
      expect.objectContaining({ schoolId: OTHER_SCHOOL_ID, rank: 2, listed: false }),
    ]);
    expect(res.body.items[0].explanation).toMatch(/^Needs review/);
    expect(res.body.ruleBreaches).toEqual([expect.objectContaining({ schoolName: 'Demo Primary School', date: '06-10-2026', rule: 'fed_exceeds_enrolled' })]);
  });

  it('replaces the ranking when the week is scored again, keeping decisions', async () => {
    requestScores.mockResolvedValue(scores([SCHOOL_ID, OTHER_SCHOOL_ID]));
    await asOfficer.post('/api/review-lists/05-10-2026/run').send({ k: 1 });
    await asOfficer.put(`/api/review-lists/05-10-2026/decisions/${SCHOOL_ID}`).send({ status: 'explained', note: 'Sports day; visitors were fed' });
    requestScores.mockResolvedValue(scores([OTHER_SCHOOL_ID, SCHOOL_ID]));

    await asOfficer.post('/api/review-lists/05-10-2026/run').send({ k: 1 });
    const res = await asOfficer.get('/api/review-lists/05-10-2026');

    expect(res.body.items.map((i) => i.schoolId)).toEqual([OTHER_SCHOOL_ID, SCHOOL_ID]);
    expect(res.body.items[1].decision).toEqual(expect.objectContaining({ status: 'explained', note: 'Sports day; visitors were fed' }));
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM review_runs')).rows[0].n).toBe(1);
  });

  it("shows a school listed again with the officer's earlier decision on it", async () => {
    requestScores.mockResolvedValue(scores([SCHOOL_ID, OTHER_SCHOOL_ID]));
    await asOfficer.post('/api/review-lists/28-09-2026/run').send({ k: 1 });
    await asOfficer.put(`/api/review-lists/28-09-2026/decisions/${SCHOOL_ID}`).send({ status: 'explained', note: 'Enrolment rose with a new class' });

    await asOfficer.post('/api/review-lists/05-10-2026/run').send({ k: 1 });
    const res = await asOfficer.get('/api/review-lists/05-10-2026');

    expect(res.body.items[0]).toMatchObject({
      schoolId: SCHOOL_ID, listedLastWeek: true,
      earlierDecision: { week: '28-09-2026', status: 'explained', note: 'Enrolment rose with a new class' },
    });
    expect(res.body.items[1]).toMatchObject({ listedLastWeek: false, earlierDecision: null });
  });

  it('lists scored weeks with how many listed schools are decided', async () => {
    requestScores.mockResolvedValue(scores([SCHOOL_ID, OTHER_SCHOOL_ID]));
    await asOfficer.post('/api/review-lists/05-10-2026/run').send({ k: 1 });
    await asOfficer.post('/api/review-lists/28-09-2026/run').send({ k: 1 });
    await asOfficer.put(`/api/review-lists/05-10-2026/decisions/${SCHOOL_ID}`).send({ status: 'follow_up', note: 'Visit to check the register' });

    const res = await asOfficer.get('/api/review-lists');

    expect(res.body.weeks).toEqual([
      expect.objectContaining({ week: '05-10-2026', listed: 1, decided: 1 }),
      expect.objectContaining({ week: '28-09-2026', listed: 1, decided: 0 }),
    ]);
  });

  it('leaves follow-up weeks out of later fits', async () => {
    requestScores.mockResolvedValue(scores([SCHOOL_ID, OTHER_SCHOOL_ID]));
    await asOfficer.post('/api/review-lists/28-09-2026/run').send({});
    await asOfficer.put(`/api/review-lists/28-09-2026/decisions/${SCHOOL_ID}`).send({ status: 'follow_up', note: 'Visit to check the register' });

    await asOfficer.post('/api/review-lists/05-10-2026/run').send({});

    expect(requestScores.mock.calls[1][0].follow_up).toEqual([{ school_id: SCHOOL_ID, week: '2026-40' }]);
  });

  it('stores nothing when the scoring service is unavailable', async () => {
    requestScores.mockRejectedValue(new ScoringServiceUnavailableError('The scoring service is not reachable'));

    const res = await asOfficer.post('/api/review-lists/05-10-2026/run').send({});

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not reachable/);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM review_runs')).rows[0].n).toBe(0);
  });

  it.each([
    ['06-10-2026', /Monday/],
    ['12-10-2026', /not started/],
    ['2026-10-05', /DD-MM-YYYY/],
  ])('refuses week %s', async (week, message) => {
    const res = await asOfficer.post(`/api/review-lists/${week}/run`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it('refuses a week that has not been scored', async () => {
    expect((await asOfficer.get('/api/review-lists/05-10-2026')).status).toBe(404);
  });
});

describe('decisions', () => {
  beforeEach(async () => {
    requestScores.mockResolvedValue(scores([SCHOOL_ID, OTHER_SCHOOL_ID]));
    await asOfficer.post('/api/review-lists/05-10-2026/run').send({ k: 1 });
  });

  it('need a status and a note', async () => {
    const noNote = await asOfficer.put(`/api/review-lists/05-10-2026/decisions/${SCHOOL_ID}`).send({ status: 'explained', note: '  ' });
    const badStatus = await asOfficer.put(`/api/review-lists/05-10-2026/decisions/${SCHOOL_ID}`).send({ status: 'fraud', note: 'x' });

    expect(noNote.status).toBe(400);
    expect(badStatus.status).toBe(400);
  });

  it('can be changed, keeping one per school and week', async () => {
    await asOfficer.put(`/api/review-lists/05-10-2026/decisions/${SCHOOL_ID}`).send({ status: 'follow_up', note: 'Visit to check the register' });
    const res = await asOfficer.put(`/api/review-lists/05-10-2026/decisions/${SCHOOL_ID}`).send({ status: 'explained', note: 'Register matched on the visit' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ status: 'explained', reviewedBy: USERS.officer.name }));
    const stored = await pool.query('SELECT status, reviewed_by FROM review_decisions');
    expect(stored.rows).toEqual([{ status: 'explained', reviewed_by: USERS.officer.id }]);
  });

  it('are only for schools ranked that week', async () => {
    const res = await asOfficer.put('/api/review-lists/28-09-2026/decisions/' + SCHOOL_ID).send({ status: 'explained', note: 'Fine' });

    expect(res.status).toBe(400);
  });
});

describe('access', () => {
  it('is refused to school staff', async () => {
    expect((await asStaff.get('/api/review-lists')).status).toBe(403);
    expect((await asStaff.post('/api/review-lists/05-10-2026/run').send({})).status).toBe(403);
  });

  it("keeps officers to their own sub-county", async () => {
    await pool.query("UPDATE schools SET sub_county = 'Other Sub-County' WHERE id = $1", [OTHER_SCHOOL_ID]);
    requestScores.mockResolvedValue(scores([SCHOOL_ID]));
    await asOfficer.post('/api/review-lists/05-10-2026/run').send({ subCounty: 'Other Sub-County' });

    const named = await asOfficer.get('/api/review-lists?subCounty=Other%20Sub-County');
    const decision = await asOfficer.put(`/api/review-lists/05-10-2026/decisions/${OTHER_SCHOOL_ID}`).send({ status: 'explained', note: 'Fine' });

    expect(named.status).toBe(404);
    expect(decision.status).toBe(404);
  });

  it('is refused to system administrators, who see no school records', async () => {
    expect((await asAdmin.post('/api/review-lists/05-10-2026/run').send({ subCounty: 'Mfano Sub-County' })).status).toBe(403);
    expect((await asAdmin.get('/api/review-lists?subCounty=Mfano%20Sub-County')).status).toBe(403);
  });

  it('refuses an unknown sub-county', async () => {
    const res = await asOfficer.post('/api/review-lists/05-10-2026/run').send({ subCounty: 'Nowhere' });

    expect(res.status).toBe(404);
    expect(requestScores).not.toHaveBeenCalled();
  });
});
