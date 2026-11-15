const request = require('supertest');
const app = require('../src/app');
const { api } = require('./helpers/auth');
const { pool, resetDatabase, SCHOOL_ID } = require('./helpers/fixtures');

const asAdmin = api(app);
const asOfficer = api(app, 'officer');
const asStaff = api(app, 'staff');

// Seeded in the officer's sub-county; the other is created in a different one
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

// Example dates for the tests only (the real 2027 calendar comes from the Ministry's circular)
function term(overrides = {}) {
  return {
    year: 2027, term: 1, opensOn: '04-01-2027', closesOn: '02-04-2027',
    halfTermStart: '24-02-2027', halfTermEnd: '28-02-2027', ...overrides,
  };
}

function holiday(overrides = {}) {
  return { kind: 'public_holiday', name: 'New Year\'s Day', startsOn: '01-01-2027', endsOn: '01-01-2027', ...overrides };
}

function closure(overrides = {}) {
  return { kind: 'school_closure', name: 'Water tank repairs', startsOn: '11-01-2027', endsOn: '12-01-2027', schoolId: SCHOOL_ID, ...overrides };
}

const deviceChanges = () => asStaff.get(`/api/sync/changes?schoolId=${SCHOOL_ID}`);

describe('who may change the calendar', () => {
  it('requires sign-in', async () => {
    expect((await request(app).get('/api/calendar/terms')).status).toBe(401);
  });

  it.each([
    ['list terms', (a) => a.get('/api/calendar/terms')],
    ['add a term', (a) => a.post('/api/calendar/terms').send(term())],
  ])('only administrators may %s', async (_, call) => {
    expect((await call(asOfficer)).status).toBe(403);
    expect((await call(asStaff)).status).toBe(403);
  });

  it('school staff cannot add calendar dates', async () => {
    const res = await asStaff.post('/api/calendar/events').send(closure());

    expect(res.status).toBe(403);
  });
});

describe('terms', () => {
  it('lists the national terms by date', async () => {
    const res = await asAdmin.get('/api/calendar/terms');

    expect(res.status).toBe(200);
    expect(res.body.terms).toHaveLength(9);
    expect(res.body.terms[8]).toMatchObject({
      year: 2026, term: 3, label: 'Term 3 2026', opensOn: '24-08-2026', closesOn: '23-10-2026', halfTermStart: null,
    });
  });

  it('adds a term with its half-term', async () => {
    const res = await asAdmin.post('/api/calendar/terms').send(term());

    expect(res.status).toBe(201);
    expect(res.body.term).toMatchObject({ year: 2027, term: 1, opensOn: '04-01-2027', halfTermEnd: '28-02-2027', practice: false });
    const row = (await pool.query("SELECT to_char(opens_on, 'YYYY-MM-DD') AS d FROM school_terms WHERE year = 2027")).rows[0];
    expect(row.d).toBe('2027-01-04');
  });

  it('adds a term without a half-term', async () => {
    const res = await asAdmin.post('/api/calendar/terms').send(term({ halfTermStart: '', halfTermEnd: null }));

    expect(res.status).toBe(201);
    expect(res.body.term.halfTermStart).toBeNull();
  });

  it.each([
    ['a term number outside 1-3', { term: 4 }, 'Term must be 1, 2 or 3'],
    ['a date that is not real', { opensOn: '31-02-2027' }, 'Opens: Use a real date'],
    ['an ISO date', { closesOn: '2027-04-02' }, 'Closes: Use a real date'],
    ['closing before it opens', { closesOn: '03-01-2027', halfTermStart: null, halfTermEnd: null }, 'close after it opens'],
    ['opening in another year', { opensOn: '28-12-2026' }, 'must open in 2027'],
    ['only one half-term date', { halfTermEnd: null }, 'both half-term dates'],
    ['a half-term outside the term', { halfTermEnd: '05-04-2027' }, 'inside the term'],
    ['a half-term that ends before it starts', { halfTermStart: '26-02-2027', halfTermEnd: '25-02-2027' }, 'end on or after'],
  ])('refuses %s', async (_, overrides, message) => {
    const res = await asAdmin.post('/api/calendar/terms').send(term(overrides));

    expect(res.status).toBe(400);
    expect(res.body.error).toContain(message);
  });

  it('refuses a term that is already in the calendar', async () => {
    await asAdmin.post('/api/calendar/terms').send(term());

    const res = await asAdmin.post('/api/calendar/terms').send(term({ opensOn: '05-04-2027', closesOn: '30-04-2027', halfTermStart: null, halfTermEnd: null }));

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Term 1 2027 is already in the calendar');
  });

  it('refuses dates that overlap another term', async () => {
    await asAdmin.post('/api/calendar/terms').send(term());

    const res = await asAdmin.post('/api/calendar/terms').send(term({ term: 2, opensOn: '01-04-2027', closesOn: '30-07-2027', halfTermStart: null, halfTermEnd: null }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('These dates overlap Term 1 2027');
  });

  it('changes a term\'s dates and removes its half-term', async () => {
    const { id } = (await asAdmin.post('/api/calendar/terms').send(term())).body.term;

    const res = await asAdmin.patch(`/api/calendar/terms/${id}`).send({ closesOn: '09-04-2027', halfTermStart: null, halfTermEnd: null });

    expect(res.status).toBe(200);
    expect(res.body.term).toMatchObject({ opensOn: '04-01-2027', closesOn: '09-04-2027', halfTermStart: null, halfTermEnd: null });
  });

  it('checks a changed term against the others but not itself', async () => {
    const { id } = (await asAdmin.post('/api/calendar/terms').send(term())).body.term;

    expect((await asAdmin.patch(`/api/calendar/terms/${id}`).send({ opensOn: '05-01-2027' })).status).toBe(200);
    const clash = await asAdmin.patch(`/api/calendar/terms/${id}`).send({ year: 2026, term: 3, opensOn: '01-09-2026', closesOn: '30-09-2026', halfTermStart: null, halfTermEnd: null });
    expect(clash.status).toBe(400);
  });

  it('removes a term nobody has used', async () => {
    const { id } = (await asAdmin.post('/api/calendar/terms').send(term())).body.term;

    const res = await asAdmin.delete(`/api/calendar/terms/${id}`);

    expect(res.status).toBe(204);
    expect((await pool.query('SELECT 1 FROM school_terms WHERE id = $1', [id])).rows).toHaveLength(0);
  });

  it('keeps a term that schools have entered enrolment for', async () => {
    const termId = (await pool.query('SELECT id FROM school_terms WHERE year = 2026 AND term = 3')).rows[0].id;
    await pool.query("INSERT INTO enrolment (school_id, term_id, class, sex, learners) VALUES ($1, $2, 'Grade 4', 'F', 20)", [SCHOOL_ID, termId]);

    const res = await asAdmin.delete(`/api/calendar/terms/${termId}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('cannot be removed');
  });

  it('leaves practice terms alone', async () => {
    const { id } = (await pool.query(
      "INSERT INTO school_terms (year, term, opens_on, closes_on, label, practice) VALUES (2026, NULL, '2026-11-02', '2026-11-27', 'Demonstration term', true) RETURNING id"
    )).rows[0];

    expect((await asAdmin.patch(`/api/calendar/terms/${id}`).send({ closesOn: '30-11-2026' })).status).toBe(400);
    expect((await asAdmin.delete(`/api/calendar/terms/${id}`)).status).toBe(400);
    // A practice term does not count as an overlap with a national term
    expect((await asAdmin.post('/api/calendar/terms').send(term({ year: 2026, term: 3, opensOn: '02-11-2026', closesOn: '27-11-2026', halfTermStart: null, halfTermEnd: null }))).status).toBe(409);
  });

  it('answers 404 for an unknown term', async () => {
    expect((await asAdmin.patch('/api/calendar/terms/99999999-9999-9999-9999-999999999999').send({})).status).toBe(404);
    expect((await asAdmin.delete('/api/calendar/terms/not-an-id')).status).toBe(404);
  });
});

describe('national dates (administrators)', () => {
  it('adds a public holiday and a national exam, recording who added them', async () => {
    const res = await asAdmin.post('/api/calendar/events').send(holiday());
    const exam = await asAdmin.post('/api/calendar/events').send({ kind: 'national_exam', name: 'KPSEA 2027', startsOn: '01-11-2027', endsOn: '05-11-2027' });

    expect(res.status).toBe(201);
    expect(res.body.event).toMatchObject({ kind: 'public_holiday', name: 'New Year\'s Day', startsOn: '01-01-2027', schoolId: null });
    expect(exam.status).toBe(201);
    const row = (await pool.query('SELECT created_by FROM calendar_events WHERE id = $1', [res.body.event.id])).rows[0];
    expect(row.created_by).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1');
  });

  it('takes a one-day date when the end is left out', async () => {
    const res = await asAdmin.post('/api/calendar/events').send(holiday({ endsOn: undefined }));

    expect(res.body.event.endsOn).toBe('01-01-2027');
  });

  it('lists one year\'s national dates, never a school\'s own', async () => {
    await asOfficer.post('/api/calendar/events').send(closure({ startsOn: '20-10-2026', endsOn: '20-10-2026' }));

    const res = await asAdmin.get('/api/calendar/events?year=2026');

    expect(res.status).toBe(200);
    expect(res.body.events.length).toBeGreaterThan(5);
    expect(res.body.events.every((e) => e.schoolId === null && e.startsOn.endsWith('2026'))).toBe(true);
  });

  it.each([
    ['a school closure', closure(), 'public holiday or national exam'],
    ['no name', holiday({ name: '  ' }), 'Give it a name'],
    ['a long name', holiday({ name: 'x'.repeat(121) }), '120 characters'],
    ['an end before the start', holiday({ endsOn: '31-12-2026' }), 'end on or after'],
    ['more than a year', holiday({ endsOn: '02-01-2028' }), 'more than a year'],
  ])('refuses %s', async (_, body, message) => {
    const res = await asAdmin.post('/api/calendar/events').send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain(message);
  });

  it('changes and removes a national date', async () => {
    const { id } = (await asAdmin.post('/api/calendar/events').send(holiday())).body.event;

    const changed = await asAdmin.patch(`/api/calendar/events/${id}`).send({ name: 'New Year', startsOn: '01-01-2027' });
    const removed = await asAdmin.delete(`/api/calendar/events/${id}`);

    expect(changed.status).toBe(200);
    expect(changed.body.event.name).toBe('New Year');
    expect(removed.status).toBe(204);
  });

  it('cannot change or remove a school\'s own date', async () => {
    const { id } = (await asOfficer.post('/api/calendar/events').send(closure())).body.event;

    expect((await asAdmin.patch(`/api/calendar/events/${id}`).send({ name: 'Renamed' })).status).toBe(404);
    expect((await asAdmin.delete(`/api/calendar/events/${id}`)).status).toBe(404);
  });
});

describe('school dates (programme officers)', () => {
  it('adds a closure for a school in their sub-county', async () => {
    const res = await asOfficer.post('/api/calendar/events').send(closure({ schoolId: SAME_SUB_COUNTY_SCHOOL }));

    expect(res.status).toBe(201);
    expect(res.body.event).toMatchObject({ kind: 'school_closure', schoolId: SAME_SUB_COUNTY_SCHOOL });
    expect(res.body.event.schoolName).toBeTruthy();
  });

  it('cannot add dates for a school elsewhere, or national dates', async () => {
    const elsewhere = await asOfficer.post('/api/calendar/events').send(closure({ schoolId: ELSEWHERE_SCHOOL }));
    const national = await asOfficer.post('/api/calendar/events').send(holiday());

    expect(elsewhere.status).toBe(404);
    expect(national.status).toBe(400);
  });

  it('cannot move a closure to a school elsewhere or change national dates', async () => {
    const { id } = (await asOfficer.post('/api/calendar/events').send(closure())).body.event;
    const nationalId = (await pool.query("SELECT id FROM calendar_events WHERE name = 'Mashujaa Day' LIMIT 1")).rows[0].id;

    expect((await asOfficer.patch(`/api/calendar/events/${id}`).send({ schoolId: ELSEWHERE_SCHOOL })).status).toBe(404);
    expect((await asOfficer.delete(`/api/calendar/events/${nationalId}`)).status).toBe(404);
  });

  it('lists national dates and their own schools\' dates only', async () => {
    await asOfficer.post('/api/calendar/events').send(closure());
    await pool.query(
      "INSERT INTO calendar_events (school_id, starts_on, ends_on, kind, name) VALUES ($1, '2027-01-11', '2027-01-11', 'school_event', 'Sports day')",
      [ELSEWHERE_SCHOOL]
    );

    const res = await asOfficer.get('/api/calendar/events?year=2027');

    expect(res.body.events.map((e) => e.name)).toEqual(['Water tank repairs']);
  });

  it('changes and removes a closure', async () => {
    const { id } = (await asOfficer.post('/api/calendar/events').send(closure())).body.event;

    expect((await asOfficer.patch(`/api/calendar/events/${id}`).send({ kind: 'school_event', name: 'Prize day' })).body.event)
      .toMatchObject({ kind: 'school_event', name: 'Prize day' });
    expect((await asOfficer.delete(`/api/calendar/events/${id}`)).status).toBe(204);
  });
});

describe('school devices get calendar changes on their next sync', () => {
  it('downloads a new term and holiday, then their changes and removal', async () => {
    const first = await deviceChanges();
    const { id: termId } = (await asAdmin.post('/api/calendar/terms').send(term())).body.term;
    const { id: eventId } = (await asAdmin.post('/api/calendar/events').send(holiday())).body.event;
    const { id: closureId } = (await asOfficer.post('/api/calendar/events').send(closure())).body.event;

    // Reference data comes whole with every download, whatever the cursor
    const next = await asStaff.get(`/api/sync/changes?schoolId=${SCHOOL_ID}&since=${first.body.cursor}`);
    expect(next.body.terms).toContainEqual(expect.objectContaining({ id: termId, year: 2027, term: 1, halfTermStart: '24-02-2027' }));
    expect(next.body.calendarEvents).toContainEqual(expect.objectContaining({ id: eventId, kind: 'public_holiday', startsOn: '01-01-2027' }));
    expect(next.body.calendarEvents).toContainEqual(expect.objectContaining({ id: closureId, kind: 'school_closure' }));

    await asAdmin.patch(`/api/calendar/terms/${termId}`).send({ closesOn: '09-04-2027' });
    await asAdmin.delete(`/api/calendar/events/${eventId}`);
    const after = await asStaff.get(`/api/sync/changes?schoolId=${SCHOOL_ID}&since=${next.body.cursor}`);

    expect(after.body.terms).toContainEqual(expect.objectContaining({ id: termId, closesOn: '09-04-2027' }));
    expect(after.body.calendarEvents.map((e) => e.id)).not.toContain(eventId);
  });
});

describe('filling in a year\'s public holidays', () => {
  const clock = require('../src/utils/clock');
  const { prefillNextYearIfDue } = require('../src/services/calendar');
  const realNow = clock.now;
  afterEach(() => { clock.now = realNow; });

  it('adds the year\'s holidays, with Eid marked to confirm, and only once', async () => {
    const res = await asAdmin.post('/api/calendar/events/prefill').send({ year: 2027 });
    const again = await asAdmin.post('/api/calendar/events/prefill').send({ year: 2027 });

    expect(res.status).toBe(201);
    expect(res.body.added).toHaveLength(11);
    expect(res.body.added).toContainEqual(expect.objectContaining({ name: 'Good Friday', startsOn: '26-03-2027', toConfirm: false }));
    expect(res.body.added).toContainEqual(expect.objectContaining({ name: 'Eid al-Fitr', startsOn: '09-03-2027', toConfirm: true }));
    expect(again.status).toBe(200);
    expect(again.body.added).toEqual([]);
    const listed = (await asAdmin.get('/api/calendar/events?year=2027')).body.events;
    expect(listed.find((e) => e.name === 'Eid al-Fitr')).toMatchObject({ toConfirm: true, kind: 'public_holiday' });
  });

  it('adds only the holidays a year is missing', async () => {
    await asAdmin.post('/api/calendar/events').send(holiday({ startsOn: '01-01-2027' }));

    const res = await asAdmin.post('/api/calendar/events/prefill').send({ year: 2027 });

    expect(res.body.added.map((h) => h.name)).not.toContain('New Year\'s Day');
    expect(res.body.added).toHaveLength(10);
  });

  it('is for administrators only and needs a year', async () => {
    expect((await asOfficer.post('/api/calendar/events/prefill').send({ year: 2027 })).status).toBe(403);
    expect((await asAdmin.post('/api/calendar/events/prefill').send({})).status).toBe(400);
  });

  it('keeps Eid marked until an administrator confirms it, moving it if needed', async () => {
    const eid = (await asAdmin.post('/api/calendar/events/prefill').send({ year: 2027 })).body.added.find((h) => h.name === 'Eid al-Fitr');

    const renamed = await asAdmin.patch(`/api/calendar/events/${eid.id}`).send({ name: 'Eid al-Fitr' });
    expect(renamed.body.event).toMatchObject({ name: 'Eid al-Fitr', toConfirm: true });

    const confirmed = await asAdmin.patch(`/api/calendar/events/${eid.id}`).send({ startsOn: '10-03-2027', endsOn: '10-03-2027', confirmed: true });
    expect(confirmed.body.event).toMatchObject({ name: 'Eid al-Fitr', startsOn: '10-03-2027', toConfirm: false });
    expect((await pool.query('SELECT name FROM calendar_events WHERE id = $1', [eid.id])).rows[0].name).toBe('Eid al-Fitr');
  });

  it('sends pre-filled holidays to school devices under their plain names', async () => {
    await asAdmin.post('/api/calendar/events/prefill').send({ year: 2027 });

    const res = await deviceChanges();

    const eid = res.body.calendarEvents.find((e) => e.startsOn === '09-03-2027');
    expect(eid).toMatchObject({ kind: 'public_holiday', name: 'Eid al-Fitr' });
    expect(res.body.calendarEvents.filter((e) => e.startsOn.endsWith('2027'))).toHaveLength(11);
  });

  it('fills in next year by itself from 1 October, once', async () => {
    clock.now = () => new Date('2026-09-30T06:00:00Z');
    expect(await prefillNextYearIfDue(pool)).toBeNull();

    clock.now = () => new Date('2026-10-01T06:00:00Z');
    const first = await prefillNextYearIfDue(pool);
    expect(first).toMatchObject({ year: 2027 });
    expect(first.added).toHaveLength(11);

    // An administrator removes one: it is not put back
    await pool.query("DELETE FROM calendar_events WHERE name = 'Labour Day' AND starts_on = '2027-05-01'");
    expect(await prefillNextYearIfDue(pool)).toBeNull();
  });
});

describe('GET /api/calendar/status', () => {
  const clock = require('../src/utils/clock');
  const realNow = clock.now;
  afterEach(() => { clock.now = realNow; });
  const at = (iso) => { clock.now = () => new Date(`${iso}T06:00:00Z`); };

  it('asks for next year\'s terms from 1 November until all three are entered', async () => {
    at('2026-10-31');
    expect((await asAdmin.get('/api/calendar/status')).body).toMatchObject({ nextYear: 2027, missingTerms: [1, 2, 3], termsReminder: false });

    at('2026-11-01');
    expect((await asAdmin.get('/api/calendar/status')).body.termsReminder).toBe(true);

    await asAdmin.post('/api/calendar/terms').send(term());
    await asAdmin.post('/api/calendar/terms').send(term({ term: 2, opensOn: '03-05-2027', closesOn: '30-07-2027', halfTermStart: null, halfTermEnd: null }));
    expect((await asAdmin.get('/api/calendar/status')).body).toMatchObject({ missingTerms: [3], termsReminder: true });
    await asAdmin.post('/api/calendar/terms').send(term({ term: 3, opensOn: '30-08-2027', closesOn: '05-11-2027', halfTermStart: null, halfTermEnd: null }));
    expect((await asAdmin.get('/api/calendar/status')).body).toMatchObject({ missingTerms: [], termsReminder: false });
  });

  it('lists estimated holidays still to confirm', async () => {
    await asAdmin.post('/api/calendar/events/prefill').send({ year: 2027 });

    const res = await asAdmin.get('/api/calendar/status');

    expect(res.body.toConfirm).toEqual([expect.objectContaining({ name: 'Eid al-Fitr', startsOn: '09-03-2027' })]);
  });

  it('says when the last term has ended and no next term exists', async () => {
    at('2026-10-23');
    expect((await asOfficer.get('/api/calendar/status')).body).toEqual({ today: '23-10-2026', calendarEnded: false });

    at('2026-11-15');
    expect((await asOfficer.get('/api/calendar/status')).body.calendarEnded).toBe(true);

    await asAdmin.post('/api/calendar/terms').send(term());
    expect((await asOfficer.get('/api/calendar/status')).body.calendarEnded).toBe(false);
  });

  it('is not for school staff', async () => {
    expect((await asStaff.get('/api/calendar/status')).status).toBe(403);
  });
});
