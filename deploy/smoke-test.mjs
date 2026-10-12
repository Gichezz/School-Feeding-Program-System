#!/usr/bin/env node
/**
 * Smoke test for a running Lishe deployment (Docker Compose locally, or the public server).
 * It checks that the web app is served, then signs in and goes through the main flows:
 * recording online, a record captured offline and synced later, and a forecast.
 *
 *   BASE_URL=http://localhost:8080 SMOKE_EMAIL=... SMOKE_PASSWORD=... node deploy/smoke-test.mjs
 *
 * SMOKE_EMAIL and SMOKE_PASSWORD must belong to an active account. Each run writes one
 * attendance record and one meal record at the first school, on a random day between
 * 2000 and 2009 (or SMOKE_DATE, DD-MM-YYYY), so real school days are never touched and
 * the test can be run again. Needs Node 18 or later (built-in fetch).
 */

const BASE_URL = (process.env.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;
const DATE = process.env.SMOKE_DATE || randomPastDate();

/**
 * A random day between 01-01-2000 and 31-12-2009, as DD-MM-YYYY.
 */
function randomPastDate() {
  const start = Date.UTC(2000, 0, 1);
  const day = new Date(start + Math.floor(Math.random() * 3653) * 86400000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(day.getUTCDate())}-${pad(day.getUTCMonth() + 1)}-${day.getUTCFullYear()}`;
}

let failures = 0;

function pass(message) {
  console.log(`  ok   ${message}`);
}

function fail(message, detail) {
  failures += 1;
  console.log(`  FAIL ${message}${detail ? `\n       ${detail}` : ''}`);
}

function check(condition, message, detail) {
  if (condition) pass(message);
  else fail(message, detail);
  return condition;
}

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : await response.text();
  return { status: response.status, headers: response.headers, data };
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    throw new Error('Set SMOKE_EMAIL and SMOKE_PASSWORD to an active account.');
  }
  console.log(`Smoke test against ${BASE_URL}`);

  console.log('Web app');
  const home = await request('/');
  check(home.status === 200 && String(home.data).includes('<div id="root">'), 'serves the app');
  const deepLink = await request('/attendance');
  check(deepLink.status === 200 && String(deepLink.data).includes('<div id="root">'), 'deep links load the app');
  const sw = await request('/sw.js');
  check(sw.status === 200 && /no-cache/.test(sw.headers.get('cache-control') || ''), 'service worker is served and never cached');
  const manifest = await request('/manifest.webmanifest');
  check(manifest.status === 200 && /Lishe/.test(typeof manifest.data === 'string' ? manifest.data : JSON.stringify(manifest.data)), 'PWA manifest is served');

  console.log('API');
  const health = await request('/api/health');
  check(health.status === 200 && health.data.database === 'connected', 'health check reports the database connected', JSON.stringify(health.data));
  const anonymous = await request('/api/schools');
  check(anonymous.status === 401, 'API refuses requests without sign-in');

  const login = await request('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  if (!check(login.status === 200 && login.data.token, 'signs in', JSON.stringify(login.data))) return;
  const token = login.data.token;

  const schools = await request('/api/schools', { token });
  const school = schools.data.schools?.[0];
  if (!check(Boolean(school), 'lists schools', JSON.stringify(schools.data))) return;

  console.log('Recording online');
  const online = await request('/api/attendance', {
    token,
    method: 'POST',
    body: { school_id: school.id, attendance_date: DATE, total_registered: 100, total_present: 92, total_absent: 8, client_id: 'smoke-test' },
  });
  check(online.status === 201, `records attendance for ${DATE}`, JSON.stringify(online.data));

  console.log('Offline capture, synced later');
  const sync = await request('/api/sync', {
    token,
    method: 'POST',
    body: {
      clientId: 'smoke-test-device',
      operations: [{
        id: `smoke-${Date.now()}`,
        entityType: 'mealDistribution',
        operation: 'create',
        baseVersion: 0,
        payload: { schoolId: school.id, distributionDate: DATE, mealsPrepared: 100, mealsServed: 95 },
      }],
    },
  });
  const result = sync.data.results?.[0];
  check(sync.status === 200 && result?.status === 'synced', 'a queued meal record syncs', JSON.stringify(sync.data));

  const report = await request(`/api/reports/meals?startDate=${DATE}&endDate=${DATE}`, { token });
  check(report.status === 200 && report.data.meals?.some((m) => m.meals_served === 95), 'the synced record appears in reports', JSON.stringify(report.data));

  console.log('Forecast');
  const forecast = await request(`/api/forecasts?school_id=${school.id}&horizon_days=7`, { token });
  check(
    forecast.status === 200 && forecast.data.source === 'live' && Array.isArray(forecast.data.forecast) && forecast.data.forecast.length > 0,
    'returns a live forecast from the forecasting service',
    JSON.stringify(forecast.data).slice(0, 300)
  );
}

main()
  .catch((error) => fail('smoke test could not run', error.message))
  .finally(() => {
    console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} smoke check(s) failed.`);
    process.exitCode = failures === 0 ? 0 : 1;
  });
