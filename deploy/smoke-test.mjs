#!/usr/bin/env node
/**
 * Smoke test for a running Lishe deployment (Docker Compose locally, or the public server).
 * It checks that the web app is served, then signs in and goes through the main flows the
 * way the three roles do: the system administrator approves a school device, the feeding
 * teacher signs in on it and records (online, and a record captured offline and synced
 * later), the programme officer sees the late entries under Record review, and the
 * administrator is refused school records (least privilege).
 *
 *   BASE_URL=http://localhost:8080 SMOKE_EMAIL=... SMOKE_PASSWORD=... \
 *   SMOKE_STAFF_EMAIL=... SMOKE_STAFF_PASSWORD=... SMOKE_OFFICER_EMAIL=... SMOKE_OFFICER_PASSWORD=... \
 *     node deploy/smoke-test.mjs
 *
 * SMOKE_EMAIL and SMOKE_PASSWORD belong to an active system administrator. The staff
 * account (a feeding teacher) and the officer account are optional; without them the
 * recording and review checks are skipped. The teacher is set up on a new device named
 * "Smoke test device", which the administrator approves and removes again at the end.
 * Each run writes one attendance record and one meal record at the teacher's school, on a
 * random day between 2000 and 2009 (or SMOKE_DATE, DD-MM-YYYY), so real school days are
 * never touched and the test can be run again. Those dates are long past the entry
 * window (#62), so the records carry a late-entry reason and are flagged under Record
 * review, where the officer can see they came from the smoke test. Needs Node 18 or later
 * (built-in fetch).
 */

import { generateKeyPairSync, sign } from 'node:crypto';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;
const STAFF_EMAIL = process.env.SMOKE_STAFF_EMAIL;
const STAFF_PASSWORD = process.env.SMOKE_STAFF_PASSWORD;
const OFFICER_EMAIL = process.env.SMOKE_OFFICER_EMAIL;
const OFFICER_PASSWORD = process.env.SMOKE_OFFICER_PASSWORD;
const PIN = '482916';
const DATE = process.env.SMOKE_DATE || randomPastDate();
const LATE_REASON = 'Smoke test of the deployment';

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

/**
 * A school device: a P-256 key pair, as the app makes with WebCrypto. The server checks
 * each sign-in by a fresh challenge signed with the private key.
 */
function newDeviceKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const { kty, crv, x, y } = publicKey.export({ format: 'jwk' });
  return {
    publicKey: { kty, crv, x, y },
    sign: (challenge) => sign('sha256', Buffer.from(challenge, 'utf8'), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url'),
  };
}

async function signedChallenge(key) {
  const { data } = await request('/api/devices/challenge', { method: 'POST' });
  return { challenge: data.challenge, signature: key.sign(data.challenge) };
}

/** Set up a device for the teacher, approve it as the administrator, and sign in on it. */
async function teacherOnNewDevice(adminToken) {
  const key = newDeviceKey();
  const enrol = await request('/api/devices/enrol', {
    method: 'POST',
    body: { email: STAFF_EMAIL, password: STAFF_PASSWORD, pin: PIN, deviceName: 'Smoke test device', publicKey: key.publicKey, ...(await signedChallenge(key)) },
  });
  if (!check(enrol.status === 201 && enrol.data.device?.id, 'a school device is set up for the feeding teacher', JSON.stringify(enrol.data))) return null;
  const device = enrol.data.device;
  const approve = await request(`/api/devices/${device.id}/approve`, { token: adminToken, method: 'POST' });
  if (!check(approve.status === 200, 'the system administrator approves it', JSON.stringify(approve.data))) return { device };
  const signIn = await request('/api/devices/sign-in', {
    method: 'POST',
    body: { email: STAFF_EMAIL, pin: PIN, deviceId: device.id, ...(await signedChallenge(key)) },
  });
  if (!check(signIn.status === 200 && signIn.data.token, 'the teacher signs in on it with their PIN', JSON.stringify(signIn.data))) return { device };
  return { device, token: signIn.data.token };
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

  console.log('Least privilege');
  const adminFlags = await request('/api/review/flags', { token });
  const adminRecords = await request(`/api/sync/changes?schoolId=${school.id}&since=0`, { token });
  check(adminFlags.status === 403 && adminRecords.status === 403, 'the system administrator is refused school records',
    `${adminFlags.status} ${adminRecords.status}`);

  if (!STAFF_EMAIL || !STAFF_PASSWORD) {
    console.log('Recording: skipped (set SMOKE_STAFF_EMAIL and SMOKE_STAFF_PASSWORD)');
  } else {
    console.log('School device');
    const teacher = await teacherOnNewDevice(token);
    try {
      if (teacher?.token) await recordAsTeacher(teacher.token, teacher.device.schoolId);
    } finally {
      // Leave no smoke-test device able to sign in
      if (teacher?.device) {
        const revoke = await request(`/api/devices/${teacher.device.id}/revoke`, { token, method: 'POST' });
        check(revoke.status === 200, 'the test device is removed again', JSON.stringify(revoke.data));
      }
    }
  }

  // Checked through the API, which is the only thing that calls it; scoring a real week
  // would write a review list on a live server
  console.log('Scoring service');
  check(health.data.scoring === 'reachable', 'the API reaches the scoring service for the weekly review list', JSON.stringify(health.data));
}

async function recordAsTeacher(token, schoolId) {
  console.log('Recording online');
  const online = await request('/api/attendance', {
    token,
    method: 'POST',
    body: { school_id: schoolId, attendance_date: DATE, total_registered: 100, total_present: 92, total_absent: 8, client_id: 'smoke-test', late_reason: LATE_REASON },
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
        payload: { schoolId, distributionDate: DATE, mealsPrepared: 100, mealsServed: 95, lateReason: LATE_REASON },
      }],
    },
  });
  const result = sync.data.results?.[0];
  check(sync.status === 200 && result?.status === 'synced', 'a queued meal record syncs', JSON.stringify(sync.data));

  const report = await request(`/api/reports/meals?startDate=${DATE}&endDate=${DATE}`, { token });
  check(report.status === 200 && report.data.meals?.some((m) => m.meals_served === 95), 'the synced record appears in reports', JSON.stringify(report.data));

  if (!OFFICER_EMAIL || !OFFICER_PASSWORD) {
    console.log('Record review: skipped (set SMOKE_OFFICER_EMAIL and SMOKE_OFFICER_PASSWORD)');
    return;
  }
  console.log('Record review');
  const officer = await request('/api/auth/login', { method: 'POST', body: { email: OFFICER_EMAIL, password: OFFICER_PASSWORD } });
  if (!check(officer.status === 200 && officer.data.token, 'the programme officer signs in', JSON.stringify(officer.data))) return;
  const flags = await request('/api/review/flags', { token: officer.data.token });
  check(
    flags.status === 200 && flags.data.flags?.some((f) => f.flag === 'entered_late' && f.values?.date === DATE && f.lateReason === LATE_REASON),
    'late entries are flagged for review with their reason',
    JSON.stringify(flags.data).slice(0, 300)
  );
}

main()
  .catch((error) => fail('smoke test could not run', error.message))
  .finally(() => {
    console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} smoke check(s) failed.`);
    process.exitCode = failures === 0 ? 0 : 1;
  });
