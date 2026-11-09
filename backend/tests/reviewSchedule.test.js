jest.mock('../src/services/scoringClient', () => {
  const actual = jest.requireActual('../src/services/scoringClient');
  return { ...actual, requestScores: jest.fn() };
});

const app = require('../src/app');
const { api } = require('./helpers/auth');
const { pool, resetDatabase, SCHOOL_ID } = require('./helpers/fixtures');
const { requestScores, ScoringServiceUnavailableError } = require('../src/services/scoringClient');
const { finishedWeeks, runSchedulePass } = require('../src/services/weeklyReviewSchedule');

// The test clock is Thursday 8 October 2026: the week in progress starts Monday 5 October,
// and the finished weeks before it start 28 September, 21 September and so on
const asOfficer = api(app, 'officer');
const OTHER_SCHOOL_ID = '11111111-1111-1111-1111-111111111112';
const SUB_COUNTY = 'Mfano Sub-County';
const quiet = { info: () => {}, warn: () => {} };

beforeEach(async () => {
  await resetDatabase();
  requestScores.mockReset();
  requestScores.mockImplementation(async (body) => scores(body.week_start, [SCHOOL_ID, OTHER_SCHOOL_ID]));
});
afterAll(() => pool.end());

async function addFeeding(schoolId, date, fed = 400) {
  await pool.query(
    `INSERT INTO daily_feeding (school_id, feeding_date, feeding_happened, learners_present, learners_fed, cereals_kg, pulses_kg,
                                captured_at, received_at)
     VALUES ($1, $2, true, $3, $3, 60, 12, $2::date + time '07:30', NOW())`,
    [schoolId, date, fed]
  );
}

function scores(weekStart, schoolIds) {
  return {
    week_start: weekStart,
    mode: 'extended_isolation_forest',
    model: { method: 'extended_isolation_forest', settings: { n_estimators: 300, ndim: 2 }, fitted_on_rows: 480 },
    k: 3,
    items: schoolIds.map((schoolId, i) => ({
      school_id: schoolId, score: 2 - i, top_date: weekStart, reasons: ['learners fed against similar schools nearby that day'],
      explanation: 'Needs review: learners fed against similar schools nearby that day', rank: i + 1, listed: i === 0,
    })),
    rule_breaches: [],
    notice: 'Ranks records for review; it does not decide anything.',
  };
}

async function runs() {
  return (await pool.query(
    `SELECT to_char(week_start, 'YYYY-MM-DD') AS week_start, scored_by_schedule, created_by, created_at, k
     FROM review_runs WHERE sub_county = $1 ORDER BY week_start`,
    [SUB_COUNTY]
  )).rows;
}

describe('which weeks are finished', () => {
  it('lists the weeks before the one in progress, newest first', () => {
    expect(finishedWeeks(new Date('2026-10-08T06:00:00Z'), 3)).toEqual(['2026-09-28', '2026-09-21', '2026-09-14']);
  });

  it('counts Sunday as part of its week, in the schools\' time zone', () => {
    // 23:30 on Sunday 4 October in Nairobi is still that week; 00:30 on Monday is the next
    expect(finishedWeeks(new Date('2026-10-04T20:30:00Z'), 1)).toEqual(['2026-09-21']);
    expect(finishedWeeks(new Date('2026-10-04T21:30:00Z'), 1)).toEqual(['2026-09-28']);
  });
});

describe('the weekly schedule', () => {
  it('scores a finished week with records, and leaves the week in progress and empty weeks alone', async () => {
    await addFeeding(SCHOOL_ID, '2026-09-29');
    await addFeeding(OTHER_SCHOOL_ID, '2026-09-30');
    await addFeeding(SCHOOL_ID, '2026-10-06');   // the week in progress

    const pass = await runSchedulePass({ log: quiet });

    expect(pass.scored.map((w) => w.weekStart)).toEqual(['2026-09-28']);
    expect(requestScores).toHaveBeenCalledTimes(1);
    expect(requestScores.mock.calls[0][0].week_start).toBe('2026-09-28');
    const [run] = await runs();
    expect(run).toMatchObject({ week_start: '2026-09-28', scored_by_schedule: true, created_by: null, k: 3 });
  });

  it('does nothing on the next pass when no record changed', async () => {
    await addFeeding(SCHOOL_ID, '2026-09-29');
    await runSchedulePass({ log: quiet });

    const again = await runSchedulePass({ log: quiet });

    expect(again.scored).toEqual([]);
    expect(requestScores).toHaveBeenCalledTimes(1);
  });

  it('scores a week again when a record for it syncs late, keeping the decisions and k', async () => {
    await addFeeding(SCHOOL_ID, '2026-09-29');
    await runSchedulePass({ log: quiet });
    await pool.query("UPDATE review_runs SET k = 5 WHERE week_start = '2026-09-28'");
    await asOfficer.put(`/api/review-lists/28-09-2026/decisions/${SCHOOL_ID}`).send({ status: 'explained', note: 'Sports day' });
    const before = (await runs())[0].created_at;

    await addFeeding(OTHER_SCHOOL_ID, '2026-10-01');   // arrives a week late
    const pass = await runSchedulePass({ log: quiet });

    expect(pass.scored).toEqual([expect.objectContaining({ weekStart: '2026-09-28', rescore: true, k: 5 })]);
    const [run] = await runs();
    expect(new Date(run.created_at).getTime()).toBeGreaterThan(new Date(before).getTime());
    expect(requestScores.mock.calls[1][0].k).toBe(5);
    const list = await asOfficer.get('/api/review-lists/28-09-2026');
    expect(list.body.items.find((i) => i.schoolId === SCHOOL_ID).decision).toMatchObject({ status: 'explained', note: 'Sports day' });
  });

  it('scores a week again when a record in it is edited, for example after a conflict is decided', async () => {
    await addFeeding(SCHOOL_ID, '2026-09-29');
    await runSchedulePass({ log: quiet });

    await pool.query("UPDATE daily_feeding SET learners_fed = 380, version = version + 1, updated_at = NOW() WHERE feeding_date = '2026-09-29'");
    const pass = await runSchedulePass({ log: quiet });

    expect(pass.scored.map((w) => w.weekStart)).toEqual(['2026-09-28']);
  });

  it('tries a week again on the next pass when the scoring service is down', async () => {
    await addFeeding(SCHOOL_ID, '2026-09-29');
    requestScores.mockRejectedValueOnce(new ScoringServiceUnavailableError('The scoring service is not reachable'));

    const failed = await runSchedulePass({ log: quiet });
    expect(failed.failed).toHaveLength(1);
    expect(await runs()).toEqual([]);

    const retried = await runSchedulePass({ log: quiet });
    expect(retried.scored.map((w) => w.weekStart)).toEqual(['2026-09-28']);
  });

  it('skips a pass while another process holds the schedule', async () => {
    await addFeeding(SCHOOL_ID, '2026-09-29');
    const other = await pool.connect();
    try {
      await other.query('SELECT pg_advisory_lock(72017)');
      const pass = await runSchedulePass({ log: quiet });
      expect(pass.skipped).toBe(true);
      expect(requestScores).not.toHaveBeenCalled();
    } finally {
      await other.query('SELECT pg_advisory_unlock(72017)');
      other.release();
    }
  });
});

describe('scheduled and officer runs on the page', () => {
  it('says a week was scored automatically, and an officer scoring it again takes over', async () => {
    await addFeeding(SCHOOL_ID, '2026-09-29');
    await runSchedulePass({ log: quiet });

    const scheduled = await asOfficer.get('/api/review-lists/28-09-2026');
    expect(scheduled.body).toMatchObject({ scoredBySchedule: true, scoredBy: null });
    const weeks = await asOfficer.get('/api/review-lists');
    expect(weeks.body.weeks[0]).toMatchObject({ week: '28-09-2026', scoredBySchedule: true });

    const byOfficer = await asOfficer.post('/api/review-lists/28-09-2026/run').send({});
    expect(byOfficer.status).toBe(201);
    expect(byOfficer.body.scoredBySchedule).toBe(false);
    expect(byOfficer.body.scoredBy).toBeTruthy();
  });
});
