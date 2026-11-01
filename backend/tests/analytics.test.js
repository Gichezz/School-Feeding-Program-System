const app = require('../src/app');
const { api } = require('./helpers/auth');
const { pool, resetDatabase, SCHOOL_ID } = require('./helpers/fixtures');

// The test clock is Thursday 8 October 2026, in Term 3 (opened Monday 24 August)
const asAdmin = api(app);
const asOfficer = api(app, 'officer');
const asStaff = api(app, 'staff');

let termId;

beforeEach(async () => {
  await resetDatabase();
  termId = (await pool.query('SELECT id FROM school_terms WHERE year = 2026 AND term = 3')).rows[0].id;
});
afterAll(() => pool.end());

async function feedingDay(date, { happened = true, fed = 0, cereals = 0, pulses = 0, reason = null } = {}) {
  await pool.query(
    `INSERT INTO daily_feeding (school_id, feeding_date, feeding_happened, learners_fed, cereals_kg, pulses_kg, reason_code, received_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '2026-10-07T12:00:00Z')`,
    [SCHOOL_ID, date, happened, fed, cereals, pulses, reason]
  );
}

async function demoSchool(as = asOfficer) {
  const res = await as.get('/api/analytics/term');
  return { res, school: res.body.schools?.find((s) => s.schoolId === SCHOOL_ID) };
}

describe('term analytics', () => {
  beforeEach(async () => {
    await pool.query(
      "INSERT INTO enrolment (school_id, term_id, class, sex, learners) VALUES ($1, $2, 'Grade 4', 'F', 200), ($1, $2, 'Grade 4', 'M', 210)",
      [SCHOOL_ID, termId]
    );
    await feedingDay('2026-10-05', { fed: 400, cereals: 60, pulses: 16 });
    await feedingDay('2026-10-06', { fed: 380, cereals: 57, pulses: 15.2 });
    await feedingDay('2026-10-07', { happened: false, reason: 'no_food' });
    await pool.query(
      `INSERT INTO stock_movements (id, school_id, movement_date, commodity, kind, quantity_kg, note_quantity_kg, reference)
       VALUES (gen_random_uuid(), $1, '2026-08-26', 'cereals', 'delivery', 1000, 1050, 'DN-0412')`,
      [SCHOOL_ID]
    );
  });

  it('defaults to the term running today and counts its school days so far', async () => {
    const { res, school } = await demoSchool();

    expect(res.status).toBe(200);
    expect(res.body.term).toMatchObject({ id: termId, year: 2026, term: 3, opensOn: '24-08-2026' });
    expect(res.body.asOf).toBe('08-10-2026');
    expect(res.body.schools).toHaveLength(4);
    // 34 weekdays from 24 August to 8 October; no holiday falls on one
    expect(school).toMatchObject({ schoolDays: 34, recorded: 3, fed: 2, notFed: 1, missing: 31, mainReason: 'no_food' });
  });

  it('measures coverage and food issued against the ration', async () => {
    const { school } = await demoSchool();

    expect(school.enrolled).toBe(410);
    expect(school.meanFed).toBe(390);
    expect(school.coverage).toBeCloseTo(390 / 410);
    // 117 kg of cereals and 31.2 kg of pulses for 780 learner-meals: exactly the ration
    expect(school.cerealsVsRation).toBeCloseTo(1);
    expect(school.pulsesVsRation).toBeCloseTo(1);
  });

  it('works out the store and deliveries from the ledger', async () => {
    const { school } = await demoSchool();

    // 1,000 kg delivered less 117 kg issued; 58.5 kg a day
    expect(school.cerealsInStoreKg).toBe(883);
    expect(school.daysOfFood).toBe(15);
    expect(school).toMatchObject({ firstDelivery: '26-08-2026', deliveryDaysAfterOpening: 2, deliveryShortKg: 50 });
  });

  it('says when the school last synced', async () => {
    const { res, school } = await demoSchool();

    expect(school.daysSinceSync).toBe(1);
    expect(res.body.schools.find((s) => s.schoolId !== SCHOOL_ID).lastSync).toBeNull();
  });

  it('counts sync age to the end of a past term, not into the holidays', async () => {
    const term2 = (await pool.query('SELECT id FROM school_terms WHERE year = 2026 AND term = 2')).rows[0].id;
    await pool.query(
      `INSERT INTO daily_feeding (school_id, feeding_date, feeding_happened, learners_fed, cereals_kg, pulses_kg, received_at)
       VALUES ($1, (SELECT closes_on FROM school_terms WHERE id = $2), true, 380, 57, 15.2,
               (SELECT closes_on FROM school_terms WHERE id = $2) + time '15:00')`,
      [SCHOOL_ID, term2]
    );

    const res = await asOfficer.get(`/api/analytics/term?termId=${term2}`);

    expect(res.body.schools.find((s) => s.schoolId === SCHOOL_ID).daysSinceSync).toBe(0);
  });

  it("leaves out the school's own closures", async () => {
    await pool.query(
      "INSERT INTO calendar_events (school_id, starts_on, ends_on, kind, name) VALUES ($1, '2026-10-02', '2026-10-02', 'school_closure', 'Water shortage')",
      [SCHOOL_ID]
    );

    const { school } = await demoSchool();

    expect(school.schoolDays).toBe(33);
  });
});

describe('access', () => {
  it('is refused to school staff', async () => {
    expect((await asStaff.get('/api/analytics/term')).status).toBe(403);
  });

  it('needs administrators to name a sub-county', async () => {
    expect((await asAdmin.get('/api/analytics/term')).status).toBe(400);
    expect((await asAdmin.get('/api/analytics/term?subCounty=Mfano%20Sub-County')).status).toBe(200);
  });

  it('keeps officers to their own sub-county', async () => {
    expect((await asOfficer.get('/api/analytics/term?subCounty=Elsewhere')).status).toBe(404);
  });

  it('refuses an unknown term', async () => {
    expect((await asOfficer.get('/api/analytics/term?termId=33333333-3333-4333-8333-333333333333')).status).toBe(404);
  });
});
