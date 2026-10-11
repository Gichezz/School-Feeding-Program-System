const http = require('http');
const request = require('supertest');
const app = require('../src/app');
const { pool, SCHOOL_ID, MISSING_ID, resetDatabase } = require('./helpers/fixtures');

/**
 * Stub forecasting service. Each test sets `respond` to control the reply.
 */
let respond;
let lastQuery;
let closedPortUrl;
const stub = http.createServer((req, res) => {
  lastQuery = new URL(req.url, 'http://stub').searchParams;
  respond(req, res);
});

function json(status, body) {
  return (req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
}

function forecastBody(startDate) {
  return {
    model: 'prophet',
    model_name: 'prophet_test',
    target: 'estimated_meal_demand',
    trained_at: '2026-10-01T00:00:00Z',
    training_data_end: '2025-10-31',
    start_date: startDate,
    end_date: '2026-10-14',
    horizon_days: 3,
    interval_width: 0.8,
    school_days_forecast: 2,
    non_school_days_excluded: 1,
    forecast: [
      { date: '2026-10-12', day_of_week: 'Monday', predicted_demand: 520, lower_bound: 490, upper_bound: 550 },
      { date: '2026-10-13', day_of_week: 'Tuesday', predicted_demand: 515, lower_bound: -3, upper_bound: 545 },
    ],
    assumptions: ['Only school days are forecast.'],
    data_notice: 'Trained on synthetic data.',
  };
}

const baseQuery = `school_id=${SCHOOL_ID}&start_date=12-10-2026&horizon_days=3`;

beforeAll(async () => {
  await new Promise((resolve) => stub.listen(0, resolve));

  // Reserve a free port and release it, so nothing is listening there
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, resolve));
  closedPortUrl = `http://localhost:${probe.address().port}`;
  await new Promise((resolve) => probe.close(resolve));
});
beforeEach(async () => {
  await resetDatabase();
  process.env.FORECASTING_SERVICE_URL = `http://localhost:${stub.address().port}`;
  delete process.env.FORECASTING_TIMEOUT_MS;
  respond = json(200, forecastBody('2026-10-12'));
  lastQuery = null;
});
afterAll(async () => {
  await new Promise((resolve) => stub.close(resolve));
  await pool.end();
});

async function storedRows() {
  const result = await pool.query(
    "SELECT to_char(forecast_date, 'DD-MM-YYYY') AS date, predicted_meals::int, lower_bound::int, model_name FROM forecast_results ORDER BY forecast_date"
  );
  return result.rows;
}

describe('GET /api/forecasts validation', () => {
  it.each([
    ['a missing school_id', 'start_date=12-10-2026'],
    ['an ISO start_date', `school_id=${SCHOOL_ID}&start_date=2026-10-12`],
    ['an impossible date', `school_id=${SCHOOL_ID}&start_date=31-02-2026`],
    ['horizon_days below 1', `school_id=${SCHOOL_ID}&horizon_days=0`],
    ['horizon_days above 60', `school_id=${SCHOOL_ID}&horizon_days=61`],
    ['a non-numeric enrollment', `school_id=${SCHOOL_ID}&enrollment=abc`],
  ])('rejects %s with 400', async (_, query) => {
    const res = await request(app).get(`/api/forecasts?${query}`);

    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown school', async () => {
    const res = await request(app).get(`/api/forecasts?school_id=${MISSING_ID}`);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/forecasts live', () => {
  it('returns the forecast with DD-MM-YYYY dates and stores it', async () => {
    const res = await request(app).get(`/api/forecasts?${baseQuery}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      source: 'live',
      stale: false,
      stored: true,
      start_date: '12-10-2026',
      model_name: 'prophet_test',
      data_notice: 'Trained on synthetic data.',
    });
    expect(res.body.forecast.map((d) => d.date)).toEqual(['12-10-2026', '13-10-2026']);
    expect(lastQuery.get('start_date')).toBe('2026-10-12');
    expect(lastQuery.get('horizon_days')).toBe('3');

    // Negative interval bounds are clamped to 0 to satisfy the table constraint
    expect(await storedRows()).toEqual([
      { date: '12-10-2026', predicted_meals: 520, lower_bound: 490, model_name: 'prophet_test' },
      { date: '13-10-2026', predicted_meals: 515, lower_bound: 0, model_name: 'prophet_test' },
    ]);
  });

  it('replaces stored rows on a repeat request instead of duplicating them', async () => {
    await request(app).get(`/api/forecasts?${baseQuery}`);
    await request(app).get(`/api/forecasts?${baseQuery}`);

    expect(await storedRows()).toHaveLength(2);
  });

  it('uses the enrollment from the request first', async () => {
    const res = await request(app).get(`/api/forecasts?${baseQuery}&enrollment=450`);

    expect(res.body).toMatchObject({ enrollment_used: 450, enrollment_source: 'request' });
    expect(lastQuery.get('enrollment')).toBe('450');
  });

  it('otherwise uses the latest attendance record', async () => {
    // Seed data has one attendance record with 3 registered learners
    const res = await request(app).get(`/api/forecasts?${baseQuery}`);

    expect(res.body).toMatchObject({ enrollment_used: 3, enrollment_source: 'attendance_records' });
    expect(lastQuery.get('enrollment')).toBe('3');
  });

  it('falls back to the model default with no attendance history', async () => {
    await pool.query('DELETE FROM attendance_records');

    const res = await request(app).get(`/api/forecasts?${baseQuery}`);

    expect(res.body).toMatchObject({ enrollment_used: null, enrollment_source: 'model_default' });
    expect(lastQuery.has('enrollment')).toBe(false);
  });

  it('passes forecasting-service validation errors through as 400', async () => {
    respond = json(400, { error: 'start_date must be after the training data end (2025-10-31)' });

    const res = await request(app).get(`/api/forecasts?${baseQuery}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/training data end/);
  });
});

describe('GET /api/forecasts when the service is unavailable', () => {
  async function storeOneForecast() {
    await request(app).get(`/api/forecasts?${baseQuery}`);
  }

  it('returns stored forecasts marked as stale when the service is unreachable', async () => {
    await storeOneForecast();
    process.env.FORECASTING_SERVICE_URL = closedPortUrl;

    const res = await request(app).get(`/api/forecasts?${baseQuery}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: 'stored', stale: true, school_days_forecast: 2 });
    expect(res.body.forecast[0]).toMatchObject({ date: '12-10-2026', predicted_demand: 520, model_name: 'prophet_test' });
  });

  it('returns 503 when unreachable and nothing is stored', async () => {
    process.env.FORECASTING_SERVICE_URL = closedPortUrl;

    const res = await request(app).get(`/api/forecasts?${baseQuery}`);

    expect(res.status).toBe(503);
  });

  it('returns 503 after the configured timeout', async () => {
    process.env.FORECASTING_TIMEOUT_MS = '300';
    respond = () => {}; // never answers

    const started = Date.now();
    const res = await request(app).get(`/api/forecasts?${baseQuery}`);

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/300 ms/);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('returns 503 when the service has no model loaded', async () => {
    respond = json(503, { error: 'Model artifact not found' });

    const res = await request(app).get(`/api/forecasts?${baseQuery}`);

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Model artifact not found');
  });

  it('returns 502 for a non-JSON reply', async () => {
    respond = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html></html>');
    };

    const res = await request(app).get(`/api/forecasts?${baseQuery}`);

    expect(res.status).toBe(502);
  });

  it('returns 502 for a server error from the service', async () => {
    respond = json(500, { error: 'boom' });

    const res = await request(app).get(`/api/forecasts?${baseQuery}`);

    expect(res.status).toBe(502);
  });
});
