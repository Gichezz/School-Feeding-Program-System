const app = require('../src/app');
const { api } = require('./helpers/auth');
const { pool, resetDatabase, SCHOOL_ID } = require('./helpers/fixtures');

// The test clock is Thursday 8 October 2026, in Term 3 (opened Monday 24 August, closes 23 October)
const asAdmin = api(app);
const asOfficer = api(app, 'officer');
const asStaff = api(app, 'staff');

beforeEach(async () => {
  await resetDatabase();
  await pool.query(
    `INSERT INTO daily_feeding (school_id, feeding_date, feeding_happened, learners_fed, cereals_kg, pulses_kg, reason_code)
     VALUES ($1, '2026-10-05', true, 400, 60, 16, NULL),
            ($1, '2026-10-06', false, 0, 0, 0, 'no_food')`,
    [SCHOOL_ID]
  );
});
afterAll(() => pool.end());

const dayOf = (res, date) => res.body.days.find((d) => d.date === date);

describe("a school's term, day by day", () => {
  it('lists every weekday of the term with what the records say', async () => {
    const res = await asOfficer.get(`/api/schools/${SCHOOL_ID}/feeding`);

    expect(res.status).toBe(200);
    expect(res.body.term).toMatchObject({ opensOn: '24-08-2026', closesOn: '23-10-2026', closed: false });
    // 24 August to 23 October: 45 weekdays
    expect(res.body.days).toHaveLength(45);
    expect(dayOf(res, '05-10-2026')).toEqual({ date: '05-10-2026', weekday: 1, kind: 'fed', learnersFed: 400 });
    expect(dayOf(res, '06-10-2026')).toEqual({ date: '06-10-2026', weekday: 2, kind: 'not_fed', reason: 'no_food' });
    expect(dayOf(res, '07-10-2026').kind).toBe('not_recorded');
    expect(dayOf(res, '09-10-2026').kind).toBe('upcoming');
    expect(dayOf(res, '20-10-2026')).toMatchObject({ kind: 'holiday', name: 'Mashujaa Day' });
  });

  it('sums up the term so far', async () => {
    const res = await asOfficer.get(`/api/schools/${SCHOOL_ID}/feeding`);

    // 34 school days up to 8 October; 10 still to come (Mashujaa Day is a holiday)
    expect(res.body.summary).toEqual({ schoolDays: 34, fed: 1, notFed: 1, notRecorded: 32, upcoming: 10, lastFed: '05-10-2026' });
  });

  it("marks the school's own closures", async () => {
    await pool.query(
      "INSERT INTO calendar_events (school_id, starts_on, ends_on, kind, name) VALUES ($1, '2026-10-02', '2026-10-02', 'school_closure', 'Water shortage')",
      [SCHOOL_ID]
    );

    const res = await asOfficer.get(`/api/schools/${SCHOOL_ID}/feeding`);

    expect(dayOf(res, '02-10-2026')).toMatchObject({ kind: 'closure', name: 'Water shortage' });
  });

  it('lets the school’s own staff read it', async () => {
    expect((await asStaff.get(`/api/schools/${SCHOOL_ID}/feeding`)).status).toBe(200);
  });
});

describe('access', () => {
  it('is refused to system administrators, who see no school records', async () => {
    expect((await asAdmin.get(`/api/schools/${SCHOOL_ID}/feeding`)).status).toBe(403);
  });

  it('keeps officers to their own sub-county', async () => {
    const other = (await pool.query(
      "INSERT INTO schools (name, sub_county) VALUES ('Mbali Primary', 'Elsewhere') RETURNING id"
    )).rows[0].id;

    expect((await asOfficer.get(`/api/schools/${other}/feeding`)).status).toBe(404);
  });

  it('refuses a malformed school id', async () => {
    expect((await asOfficer.get('/api/schools/not-a-school/feeding')).status).toBe(400);
  });
});
