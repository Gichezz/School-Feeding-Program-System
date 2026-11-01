#!/usr/bin/env node
/**
 * Synchronisation evaluation (#72): sync success rate, conflict detection accuracy and
 * sync latency (project documentation §3.8.1, Table 3.2). Version 2 adds the records
 * schools now keep (daily feeding, enrolment, the stock ledger), two devices at one
 * school, and convergence: whether every device ends with the server's records.
 *
 * Several simulated school devices (device.js, one process each) record attendance and
 * meals through the PWA's own code and sync with the real API under controlled network
 * conditions. Every scenario has a known correct outcome, and the server's database is
 * checked record by record afterwards.
 *
 * The run uses its own throwaway database and API server (port 5065), created from
 * database/schema.sql and seed.sql with the connection settings in backend/.env, and
 * removes them at the end. Nothing else is touched.
 *
 *   cd frontend
 *   node evaluation/sync/run-sync-evaluation.js
 *
 * Writes evaluation/sync/results/sync_evaluation.json and sync_evaluation_report.md.
 */
import { fork, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '../..');
const ROOT = path.resolve(FRONTEND, '..');
const RESULTS = path.join(HERE, 'results');
const requireBackend = createRequire(path.join(ROOT, 'backend', 'package.json'));
requireBackend('dotenv').config({ path: path.join(ROOT, 'backend', '.env') });
const { Client } = requireBackend('pg');

const EVAL_DB = 'school_feeding_sync_evaluation';
const PORT = 5065;
const BASE_URL = `http://localhost:${PORT}`;
// Demo accounts from database/seed.sql (development only); the throwaway database is seeded with them
const ADMIN = { email: 'admin@demo-school.local', password: 'ChangeMeAdmin1' };
const OFFICER = { email: 'officer@demo-school.local', password: 'ChangeMeOfficer1' };
const LATE_REASON = 'Sync evaluation: backfilled day';
const AUTO_SYNC_DELAY_MS = 5000; // the app waits 5 s after reconnecting before it syncs
const AUTOMATIC_SYNC_LIMIT_MS = 180000; // how long to leave the app's automatic sync and retries alone
const MAX_SYNC_NOW_PRESSES = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Throwaway database and API server
// ---------------------------------------------------------------------------

function connectionString(database) {
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = `/${database}`;
    return url.toString();
  }
  const e = encodeURIComponent;
  return `postgresql://${e(process.env.PGUSER || 'postgres')}:${e(process.env.PGPASSWORD || '')}@`
    + `${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432}/${database}`;
}

async function withClient(database, fn) {
  const client = new Client({ connectionString: connectionString(database) });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function createDatabase() {
  await withClient('postgres', async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${EVAL_DB} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${EVAL_DB}`);
  });
  await withClient(EVAL_DB, async (c) => {
    await c.query(fs.readFileSync(path.join(ROOT, 'database', 'schema.sql'), 'utf8'));
    await c.query(fs.readFileSync(path.join(ROOT, 'database', 'calendar_kenya.sql'), 'utf8'));
    await c.query(fs.readFileSync(path.join(ROOT, 'database', 'seed.sql'), 'utf8'));
  });
}

async function dropDatabase() {
  await withClient('postgres', (c) => c.query(`DROP DATABASE IF EXISTS ${EVAL_DB} WITH (FORCE)`));
}

/** Clear all records between scenarios (accounts and the school stay). */
async function clearRecords() {
  await withClient(EVAL_DB, (c) => c.query(
    `TRUNCATE attendance_records, meal_distributions, sync_operations, conflicts, held_operations,
              record_history, record_flags, daily_feeding, enrolment, stock_movements, stock_counts,
              sync_batches CASCADE`
  ));
}

function startBackend() {
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(ROOT, 'backend'),
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: connectionString(EVAL_DB),
      JWT_SECRET: crypto.randomBytes(48).toString('hex'),
      NODE_ENV: 'production',
    },
    stdio: 'ignore',
  });
  return server;
}

async function waitForHealth() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok && (await res.json()).database === 'connected') return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error('The evaluation API server did not start');
}

// ---------------------------------------------------------------------------
// Simulated devices
// ---------------------------------------------------------------------------

const VITE_NODE = path.join(FRONTEND, 'node_modules', 'vite-node', 'vite-node.mjs');

class Device {
  constructor(name, seed, { register = false } = {}) {
    this.name = name;
    this.seed = seed;
    this.register = register;
    this.pending = new Map();
    this.nextId = 1;
    this.stderr = '';
  }

  async start() {
    this.process = fork(VITE_NODE, [path.join(HERE, 'device.js')], {
      cwd: FRONTEND,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    // The app logs every sync step and expected network errors; keep only the tail for diagnosis
    this.process.stderr.on('data', (chunk) => { this.stderr = (this.stderr + chunk).slice(-4000); });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name} did not start: ${this.stderr}`)), 60000);
      this.process.on('message', (message) => {
        if (message.ready) {
          clearTimeout(timer);
          resolve();
          return;
        }
        const waiting = this.pending.get(message.id);
        if (!waiting) return;
        this.pending.delete(message.id);
        if (message.ok) waiting.resolve(message.result);
        else waiting.reject(new Error(`${this.name}: ${message.error}`));
      });
    });
    const { schoolId } = await this.call('init', { baseUrl: BASE_URL, ...ADMIN, seed: this.seed, register: this.register });
    this.schoolId = schoolId;
    return this;
  }

  call(command, args) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process.send({ id, command, args });
    });
  }

  record(kind, date, values) {
    return this.call('record', { kind, schoolId: this.schoolId, date, values, lateReason: LATE_REASON });
  }

  network(profile) {
    return this.call('network', profile);
  }

  stop() {
    this.process?.kill();
  }
}

async function startDevices(names, seedBase, options) {
  return Promise.all(names.map((name, i) => new Device(name, seedBase + i, options).start()));
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function displayDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

/** n distinct past dates, the most recent first, skipping `offset` days back from today. */
function pastDates(n, offset = 0) {
  const today = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset - i);
    return displayDate(d);
  });
}

function attendanceValues(present) {
  return { totalRegistered: 500, totalPresent: present, totalAbsent: 500 - present };
}

function mealValues(served) {
  return { mealsPrepared: 480, mealsServed: served };
}

const valuesFor = (kind, n) => (kind === 'attendance' ? attendanceValues(n) : mealValues(n));

// ---------------------------------------------------------------------------
// Server state
// ---------------------------------------------------------------------------

async function serverRecords() {
  return withClient(EVAL_DB, async (c) => {
    const isoToDisplay = (d) => displayDate(new Date(d));
    const attendance = (await c.query(
      'SELECT id, attendance_date, total_registered, total_present, total_absent, version FROM attendance_records'
    )).rows;
    const meals = (await c.query(
      'SELECT id, distribution_date, meals_prepared, meals_served, version FROM meal_distributions'
    )).rows;
    const history = (await c.query(
      'SELECT record_id, count(*)::int AS versions FROM record_history GROUP BY record_id'
    )).rows;
    const versionsById = Object.fromEntries(history.map((h) => [h.record_id, h.versions]));
    const map = new Map();
    for (const r of attendance) {
      map.set(`attendance|${isoToDisplay(r.attendance_date)}`, {
        values: attendanceValues(r.total_present), registered: r.total_registered, version: r.version,
        historyVersions: versionsById[r.id] || 0,
      });
    }
    for (const r of meals) {
      map.set(`meals|${isoToDisplay(r.distribution_date)}`, {
        values: mealValues(r.meals_served), version: r.version, historyVersions: versionsById[r.id] || 0,
      });
    }
    const conflicts = (await c.query('SELECT count(*)::int AS n FROM conflicts')).rows[0].n;
    return { records: map, conflicts };
  });
}

const sameValues = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// Waiting for syncs
// ---------------------------------------------------------------------------

const FINAL = new Set(['synced', 'conflict', 'failed', 'held']);

/**
 * Leave the app's automatic sync alone after reconnecting (it waits 5 s, sends the queue, and
 * keeps retrying while records wait) until every operation has its answer, or the time limit
 * passes. Nobody presses "Sync now" in this phase.
 */
async function waitForAutomaticSync(devices, reconnectedAt) {
  for (;;) {
    const states = await Promise.all(devices.map((d) => d.call('state')));
    const allFinal = states.every((s) => s.operations.every((op) => FINAL.has(op.status)));
    const timedOut = Date.now() - reconnectedAt > AUTOMATIC_SYNC_LIMIT_MS && states.every((s) => !s.syncing);
    if (allFinal || timedOut) return states;
    await sleep(200);
  }
}

async function states(devices) {
  return Promise.all(devices.map((d) => d.call('state')));
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function latencySummary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.length ? sorted[sorted.length - 1] : null,
  };
}

// ---------------------------------------------------------------------------
// Scenario 1–3: records captured offline, then reconnecting
// ---------------------------------------------------------------------------

/**
 * Each device records `days` days of attendance and meals while offline (different days
 * per device, so no conflicts are expected), then reconnects with the given profile.
 * Expected: every record reaches the server once, with the device's numbers.
 */
async function captureScenario({ name, label, profile, devices: deviceCount = 3, days = 10, seedBase }) {
  await clearRecords();
  const names = Array.from({ length: deviceCount }, (_, i) => `device-${i + 1}`);
  const devices = await startDevices(names, seedBase);
  try {
    const expected = new Map();
    const dates = pastDates(deviceCount * days);
    await Promise.all(devices.map((d) => d.network({ mode: 'offline' })));
    for (const [i, device] of devices.entries()) {
      for (const [j, date] of dates.slice(i * days, (i + 1) * days).entries()) {
        for (const kind of ['attendance', 'meals']) {
          const values = valuesFor(kind, 400 + ((i * 37 + j * 11) % 80));
          await device.record(kind, date, values);
          expected.set(`${kind}|${date}`, values);
        }
      }
    }

    const reconnectedAt = Date.now();
    await Promise.all(devices.map((d) => d.network({ mode: 'online', ...profile })));
    const afterAuto = await waitForAutomaticSync(devices, reconnectedAt);
    const snapshots = [summariseCapture(afterAuto)];

    // People press "Sync now" when records are left over
    for (let press = 1; press <= MAX_SYNC_NOW_PRESSES; press += 1) {
      const left = (await states(devices)).some((s) => s.operations.some((op) => op.status === 'pending'));
      if (!left) break;
      for (const device of devices) await device.call('sync');
      snapshots.push(summariseCapture(await states(devices), press));
    }

    const finalStates = await states(devices);
    const server = await serverRecords();
    let correct = 0;
    let wrongValues = 0;
    let missing = 0;
    let repeated = 0;
    for (const [key, values] of expected) {
      const record = server.records.get(key);
      if (!record) missing += 1;
      else if (!sameValues(record.values, values)) wrongValues += 1;
      else correct += 1;
      if (record && record.historyVersions > 1) repeated += 1;
    }
    const operations = finalStates.flatMap((s) => s.operations);
    const latencies = operations.filter((op) => op.status === 'synced' && op.answeredAfterMs !== null)
      .map((op) => op.answeredAfterMs);
    const traffic = finalStates.reduce((t, s) => {
      for (const [k, v] of Object.entries(s.traffic)) t[k] = (t[k] || 0) + v;
      return t;
    }, {});

    return {
      name,
      label,
      profile,
      devices: deviceCount,
      records: expected.size,
      onServerCorrect: correct,
      missingOnServer: missing,
      wrongValuesOnServer: wrongValues,
      appliedMoreThanOnce: repeated,
      extraRecordsOnServer: [...server.records.keys()].filter((key) => !expected.has(key)).length,
      conflictsRaised: server.conflicts,
      strandedOnDevice: operations.filter((op) => op.status !== 'synced').length,
      stuckAsFailed: operations.filter((op) => op.status === 'failed').length,
      successRate: correct / expected.size,
      snapshots,
      latencyMs: latencySummary(latencies),
      traffic,
    };
  } finally {
    devices.forEach((d) => d.stop());
  }
}

function summariseCapture(deviceStates, press = 0) {
  const operations = deviceStates.flatMap((s) => s.operations);
  return {
    after: press === 0 ? 'automatic sync and retries' : `Sync now x${press}`,
    synced: operations.filter((op) => op.status === 'synced').length,
    pending: operations.filter((op) => op.status === 'pending').length,
    failed: operations.filter((op) => op.status === 'failed').length,
    total: operations.length,
  };
}

// ---------------------------------------------------------------------------
// Scenario 4: conflicts with known answers
// ---------------------------------------------------------------------------

/**
 * Two devices, A and B. A always syncs first, so only B's change can be a conflict.
 * "Shared" days are first recorded on A and synced, then recorded on B with the same
 * numbers and synced, so both devices hold version 1 before going offline.
 *
 * Cases (each repeated `reps` times on different days, alternating attendance and meals):
 *   same_record_different   both edit the same day differently       -> B should conflict
 *   same_record_identical   both edit the same day to the same numbers -> no real conflict
 *   different_records       A and B edit different days                -> no conflict
 *   new_same_day_different  both record a new day, different numbers  -> B should conflict (#70)
 *   new_same_day_identical  both record a new day, same numbers        -> no conflict (#70)
 */
const CONFLICT_CASES = [
  { name: 'same_record_different', label: 'Both edit the same record, different numbers', shared: true, expectConflict: true },
  { name: 'same_record_identical', label: 'Both edit the same record to the same numbers', shared: true, expectConflict: false },
  { name: 'different_records', label: 'The two devices edit different records', shared: true, expectConflict: false },
  { name: 'new_same_day_different', label: 'Both record the same new day, different numbers', shared: false, expectConflict: true },
  { name: 'new_same_day_identical', label: 'Both record the same new day, same numbers', shared: false, expectConflict: false },
];

async function conflictScenario({ reps = 6, seedBase }) {
  await clearRecords();
  const [a, b] = await startDevices(['device-A', 'device-B'], seedBase);
  try {
    const plan = [];
    let offset = 0;
    for (const testCase of CONFLICT_CASES) {
      for (let rep = 0; rep < reps; rep += 1) {
        const kind = rep % 2 === 0 ? 'attendance' : 'meals';
        const dayA = pastDates(1, offset++)[0];
        const dayB = testCase.name === 'different_records' ? pastDates(1, offset++)[0] : dayA;
        plan.push({ ...testCase, rep, kind, dayA, dayB });
      }
    }

    // Shared days: both devices hold version 1
    for (const step of plan.filter((s) => s.shared)) {
      for (const day of new Set([step.dayA, step.dayB])) {
        await a.record(step.kind, day, valuesFor(step.kind, 400));
        await b.record(step.kind, day, valuesFor(step.kind, 400));
      }
    }
    await a.call('sync');
    await b.call('sync');

    // Offline: each device makes its change
    await a.network({ mode: 'offline' });
    await b.network({ mode: 'offline' });
    for (const step of plan) {
      const valueA = 410 + step.rep;
      const valueB = step.name.endsWith('identical') ? valueA : 450 + step.rep;
      step.valuesA = valuesFor(step.kind, valueA);
      step.valuesB = valuesFor(step.kind, valueB);
      await a.record(step.kind, step.dayA, step.valuesA);
      await b.record(step.kind, step.dayB, step.valuesB);
    }

    // A reconnects and syncs first, then B
    await a.network({ mode: 'online' });
    await a.call('sync');
    await b.network({ mode: 'online' });
    await b.call('sync');
    await sleep(AUTO_SYNC_DELAY_MS + 1000); // let the automatic syncs run (nothing left to send)

    const [stateA, stateB] = await states([a, b]);
    const server = await serverRecords();
    const lastOp = (state, kind, day) => state.operations
      .filter((op) => op.entityType === (kind === 'attendance' ? 'attendance' : 'mealDistribution') && op.date === day)
      .at(-1);

    const rows = [];
    for (const step of plan) {
      const opA = lastOp(stateA, step.kind, step.dayA);
      const opB = lastOp(stateB, step.kind, step.dayB);
      // A's change always arrives first and is never a conflict
      rows.push({ case: step.name, device: 'A', expected: false, observed: opA.status === 'conflict', status: opA.status });
      rows.push({ case: step.name, device: 'B', expected: step.expectConflict, observed: opB.status === 'conflict', status: opB.status });
      // Nothing is lost: a conflict leaves A's numbers on the server; otherwise the last change is there
      const recordB = server.records.get(`${step.kind}|${step.dayB}`);
      const recordA = server.records.get(`${step.kind}|${step.dayA}`);
      step.serverOk = opB.status === 'conflict'
        ? sameValues(recordB?.values, step.valuesA)
        : sameValues(recordB?.values, step.valuesB) && sameValues(recordA?.values, step.valuesA);
    }

    const tp = rows.filter((r) => r.expected && r.observed).length;
    const fp = rows.filter((r) => !r.expected && r.observed).length;
    const tn = rows.filter((r) => !r.expected && !r.observed).length;
    const fn = rows.filter((r) => r.expected && !r.observed).length;
    const byCase = CONFLICT_CASES.map((c) => {
      const caseRows = rows.filter((r) => r.case === c.name && r.device === 'B');
      return {
        case: c.name,
        label: c.label,
        expectConflict: c.expectConflict,
        repetitions: caseRows.length,
        conflictsReported: caseRows.filter((r) => r.observed).length,
        correct: caseRows.filter((r) => r.observed === r.expected).length,
        serverValuesCorrect: plan.filter((s) => s.name === c.name && s.serverOk).length,
      };
    });
    return {
      name: 'conflicts',
      label: 'Conflict detection with known answers',
      operationsJudged: rows.length,
      confusion: { truePositive: tp, falsePositive: fp, trueNegative: tn, falseNegative: fn },
      accuracy: (tp + tn) / rows.length,
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
      byCase,
      recordsLost: plan.filter((s) => !s.serverOk).length,
    };
  } finally {
    a.stop();
    b.stop();
  }
}

// ---------------------------------------------------------------------------
// Version 2: the school records
// ---------------------------------------------------------------------------

const TERM = { year: 2026, term: 3 };
// School days of Term 3 2026 used below (Mashujaa Day, 20 October, is a holiday)
const SCHOOL_DAYS = ['05-10-2026', '06-10-2026', '07-10-2026', '08-10-2026', '09-10-2026',
  '12-10-2026', '13-10-2026', '14-10-2026', '15-10-2026', '16-10-2026',
  '17-09-2026', '18-09-2026', '21-09-2026', '22-09-2026', '23-09-2026', '24-09-2026', '25-09-2026',
  '28-09-2026', '29-09-2026', '30-09-2026', '01-10-2026', '02-10-2026',
  '31-08-2026', '01-09-2026', '02-09-2026', '03-09-2026', '04-09-2026', '07-09-2026', '08-09-2026', '09-09-2026',
  '10-09-2026', '11-09-2026', '14-09-2026', '15-09-2026', '16-09-2026'];
const CLASSES = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4'];

function feedingDay(schoolId, date, fed) {
  return {
    schoolId, feedingDate: date, feedingHappened: true, learnersPresent: fed + 6, learnersFed: fed,
    cerealsKg: Math.round(fed * 0.15 * 2) / 2, pulsesKg: Math.round(fed * 0.04 * 2) / 2, lateReason: LATE_REASON,
  };
}

async function termId() {
  return withClient(EVAL_DB, async (c) => (await c.query(
    'SELECT id FROM school_terms WHERE year = $1 AND term = $2', [TERM.year, TERM.term]
  )).rows[0].id);
}

async function signIn(account) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(account),
  });
  return (await res.json()).token;
}

async function apiCall(token, method, url, body) {
  const res = await fetch(`${BASE_URL}${url}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body && { body: JSON.stringify(body) }),
  });
  // Some answers have no body (204)
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

/** The server's records for the school, in the shape a device reports its own. */
async function serverSchoolState(schoolId) {
  return withClient(EVAL_DB, async (c) => {
    const day = (d) => displayDate(new Date(d));
    const feeding = (await c.query(
      'SELECT feeding_date, learners_fed, cereals_kg, pulses_kg FROM daily_feeding WHERE school_id = $1', [schoolId]
    )).rows;
    const enrolment = (await c.query('SELECT class, sex, learners FROM enrolment WHERE school_id = $1', [schoolId])).rows;
    const movements = (await c.query('SELECT id, kind, commodity, quantity_kg FROM stock_movements WHERE school_id = $1', [schoolId])).rows;
    const counts = (await c.query('SELECT id FROM stock_counts WHERE school_id = $1', [schoolId])).rows;
    const cereals = (await c.query(
      "SELECT COALESCE(SUM(quantity_kg), 0)::float AS kg FROM stock_flows WHERE school_id = $1 AND commodity = 'cereals'", [schoolId]
    )).rows[0].kg;
    const held = (await c.query('SELECT reason, status FROM held_operations')).rows;
    const history = (await c.query('SELECT record_id, count(*)::int AS n FROM record_history GROUP BY record_id HAVING count(*) > 1')).rows;
    return {
      feeding: Object.fromEntries(feeding.map((f) => [day(f.feeding_date), [f.learners_fed, Number(f.cereals_kg), Number(f.pulses_kg)]])),
      enrolment: Object.fromEntries(enrolment.map((e) => [`${e.class}|${e.sex}`, e.learners])),
      movements,
      movementIds: movements.map((m) => m.id).sort(),
      countIds: counts.map((m) => m.id).sort(),
      cereals: Math.round(cereals * 100) / 100,
      held,
      appliedTwice: history.length,
      conflicts: (await c.query('SELECT count(*)::int AS n FROM conflicts')).rows[0].n,
    };
  });
}

/** Whether a device holds exactly the server's records and stock balance. */
function converged(local, server) {
  return {
    feeding: Object.keys(differences(local.feeding, server.feeding)).length === 0,
    enrolment: Object.keys(differences(local.enrolment, server.enrolment)).length === 0,
    stockEntries: sameValues(local.movementIds, server.movementIds) && sameValues(local.countIds, server.countIds),
    cereals: Math.abs(local.cereals - server.cereals) < 0.01,
    noOpenConflicts: local.unresolvedConflicts === 0,
  };
}
const allTrue = (o) => Object.values(o).every(Boolean);

/** Where a device's records differ from the server's: { key: [device, server] }, a few at most. */
function differences(local, server, limit = 5) {
  const out = {};
  for (const key of new Set([...Object.keys(local), ...Object.keys(server)])) {
    if (!sameValues(local[key], server[key])) out[key] = [local[key] ?? null, server[key] ?? null];
    if (Object.keys(out).length >= limit) break;
  }
  return out;
}

/**
 * Scenario 6: a kitchen tablet and the office phone at one school, a week offline. The
 * kitchen records feeding and a store count; the office records enrolment, two deliveries
 * on one note and a loss; the kitchen also records the cereals delivery from the same note.
 */
async function schoolDevicesScenario({ name, label, profile, seedBase }) {
  await clearRecords();
  const [kitchen, office] = await startDevices(['kitchen-tablet', 'office-phone'], seedBase, { register: true });
  const schoolId = kitchen.schoolId;
  try {
    const term = await termId();
    // Both devices have the school's calendar before going offline, as after activation
    await kitchen.call('sync');
    await office.call('sync');
    await Promise.all([kitchen, office].map((d) => d.network({ mode: 'offline' })));

    const expected = { feeding: {}, enrolment: {} };
    for (const [j, date] of SCHOOL_DAYS.slice(0, 10).entries()) {
      const day = feedingDay(schoolId, date, 380 + ((j * 7) % 30));
      await kitchen.call('feeding', day);
      expected.feeding[date] = [day.learnersFed, day.cerealsKg, day.pulsesKg];
    }
    for (const [i, cls] of CLASSES.entries()) {
      for (const sex of ['F', 'M']) {
        const learners = 48 + i * 3 + (sex === 'F' ? 2 : 0);
        await office.call('enrolment', { schoolId, termId: term, class: cls, sex, learners });
        expected.enrolment[`${cls}|${sex}`] = learners;
      }
    }
    const note = 'DN-2026-T3-07';
    const delivery = { schoolId, movementDate: '02-10-2026', kind: 'delivery', reference: note, lateReason: LATE_REASON };
    await office.call('movement', { ...delivery, commodity: 'cereals', quantityKg: 2000, noteQuantityKg: 2000 });
    await office.call('movement', { ...delivery, commodity: 'pulses', quantityKg: 600, noteQuantityKg: 600 });
    await office.call('movement', {
      schoolId, movementDate: '08-10-2026', kind: 'loss', commodity: 'cereals', quantityKg: 20,
      note: 'Spoiled under a leaking roof', lateReason: LATE_REASON,
    });
    // The cook enters the same delivery note on the kitchen tablet
    await kitchen.call('movement', { ...delivery, reference: 'dn-2026-t3-07', commodity: 'cereals', quantityKg: 2000, noteQuantityKg: 2000 });
    await kitchen.call('count', { schoolId, countDate: '16-10-2026', commodity: 'cereals', countedKg: 1400, lateReason: LATE_REASON });

    const reconnectedAt = Date.now();
    await Promise.all([kitchen, office].map((d) => d.network({ mode: 'online', ...profile })));
    const afterAuto = await waitForAutomaticSync([kitchen, office], reconnectedAt);
    for (let press = 1; press <= MAX_SYNC_NOW_PRESSES; press += 1) {
      const left = (await states([kitchen, office])).some((st) => st.operations.some((op) => op.status === 'pending'));
      if (!left) break;
      for (const d of [kitchen, office]) await d.call('sync');
    }
    const before = await serverSchoolState(schoolId);

    // The administrator discards the second entry of the note; both devices sync again
    const admin = await signIn(ADMIN);
    const { held } = await apiCall(admin, 'GET', '/api/sync/held');
    for (const h of held) await apiCall(admin, 'POST', `/api/sync/held/${h.id}/discard`);
    await Promise.all([kitchen, office].map((d) => d.network({ mode: 'online', delayMs: profile.delayMs })));
    for (const d of [kitchen, office]) await d.call('sync');
    const server = await serverSchoolState(schoolId);
    const locals = await Promise.all([kitchen, office].map((d) => d.call('local', { schoolId })));

    const records = Object.keys(expected.feeding).length + Object.keys(expected.enrolment).length + 3 + 1;
    const feedingOk = Object.entries(expected.feeding).filter(([k, v]) => sameValues(server.feeding[k], v)).length;
    const enrolmentOk = Object.entries(expected.enrolment).filter(([k, v]) => server.enrolment[k] === v).length;
    const ledger = server.movements.map((m) => `${m.kind}|${m.commodity}|${Number(m.quantity_kg)}`).sort();
    const ledgerOk = sameValues(ledger, ['delivery|cereals|2000', 'delivery|pulses|600', 'loss|cereals|20']);
    const correct = feedingOk + enrolmentOk + (ledgerOk ? 3 : 0) + (server.countIds.length === 1 ? 1 : 0);
    const operations = (await states([kitchen, office])).flatMap((st) => st.operations);
    const latencies = afterAuto.flatMap((st) => st.operations)
      .filter((op) => op.status === 'synced' && op.answeredAfterMs !== null).map((op) => op.answeredAfterMs);
    const convergence = locals.map((local, i) => ({ device: ['kitchen tablet', 'office phone'][i], ...converged(local, server) }));
    const mismatches = locals.map((local) => ({
      feeding: differences(local.feeding, server.feeding), enrolment: differences(local.enrolment, server.enrolment),
    }));
    return {
      name,
      label,
      profile,
      kind: 'school',
      devices: 2,
      records,
      onServerCorrect: correct,
      successRate: correct / records,
      appliedMoreThanOnce: server.appliedTwice,
      duplicateHeld: before.held.length === 1 && before.held[0].reason === 'duplicate_delivery',
      duplicateInLedger: !ledgerOk,
      serverCereals: server.cereals,
      deviceCereals: locals.map((l) => l.cereals),
      convergence,
      devicesConverged: convergence.filter((x) => allTrue({ ...x, device: true })).length,
      mismatches,
      stuckAsFailed: operations.filter((op) => op.status === 'failed').length,
      latencyMs: latencySummary(latencies),
    };
  } finally {
    kitchen.stop();
    office.stop();
  }
}

/**
 * Scenario 7: conflicts on daily feeding and enrolment with known answers, resolved by the
 * programme officer from the server's list; then both devices sync again.
 */
const FEEDING_CASES = CONFLICT_CASES.map((c) => ({ ...c, record: 'dailyFeeding' }));
const ENROLMENT_CASES = [
  { name: 'enrolment_different', label: 'Both change the same class and sex, different counts', shared: true, expectConflict: true, record: 'enrolment' },
  { name: 'enrolment_identical', label: 'Both change the same class and sex to the same count', shared: true, expectConflict: false, record: 'enrolment' },
];

async function schoolConflictScenario({ reps = 3, seedBase }) {
  await clearRecords();
  const [a, b] = await startDevices(['device-A', 'device-B'], seedBase, { register: true });
  const schoolId = a.schoolId;
  try {
    const term = await termId();
    const days = [...SCHOOL_DAYS];
    const classes = CLASSES.flatMap((cls) => ['F', 'M'].map((sex) => ({ class: cls, sex })));
    const plan = [];
    for (const testCase of [...FEEDING_CASES, ...ENROLMENT_CASES]) {
      for (let rep = 0; rep < reps; rep += 1) {
        if (testCase.record === 'enrolment') {
          const who = classes.shift();
          plan.push({ ...testCase, rep, keyA: `${who.class}|${who.sex}`, keyB: `${who.class}|${who.sex}`, who });
        } else {
          const dayA = days.shift();
          const dayB = testCase.name === 'different_records' ? days.shift() : dayA;
          plan.push({ ...testCase, rep, keyA: dayA, keyB: dayB });
        }
      }
    }
    const save = (device, step, key, n) => (step.record === 'enrolment'
      ? device.call('enrolment', { schoolId, termId: term, ...step.who, learners: n })
      : device.call('feeding', feedingDay(schoolId, key, n)));

    await a.call('sync');
    await b.call('sync');
    // Shared records: both devices hold version 1
    for (const step of plan.filter((st) => st.shared)) {
      for (const key of new Set([step.keyA, step.keyB])) {
        await save(a, step, key, step.record === 'enrolment' ? 50 : 400);
        await save(b, step, key, step.record === 'enrolment' ? 50 : 400);
      }
    }
    await a.call('sync');
    await b.call('sync');

    await a.network({ mode: 'offline' });
    await b.network({ mode: 'offline' });
    for (const step of plan) {
      const base = step.record === 'enrolment' ? 52 : 410;
      step.valueA = base + step.rep;
      step.valueB = step.name.endsWith('identical') ? step.valueA : base + 20 + step.rep;
      await save(a, step, step.keyA, step.valueA);
      await save(b, step, step.keyB, step.valueB);
    }
    await a.network({ mode: 'online' });
    await a.call('sync');
    await b.network({ mode: 'online' });
    await b.call('sync');
    await sleep(AUTO_SYNC_DELAY_MS + 1000);

    const [stateA, stateB] = await states([a, b]);
    const lastOp = (state, step, key) => state.operations
      .filter((op) => op.entityType === step.record && op.key === key).at(-1);
    const rows = [];
    for (const step of plan) {
      const opA = lastOp(stateA, step, step.keyA);
      const opB = lastOp(stateB, step, step.keyB);
      rows.push({ case: step.name, device: 'A', expected: false, observed: opA?.status === 'conflict' });
      rows.push({ case: step.name, device: 'B', expected: step.expectConflict, observed: opB?.status === 'conflict' });
    }

    // The programme officer resolves every conflict from the server's list; devices sync again
    const officer = await signIn(OFFICER);
    const { conflicts } = await apiCall(officer, 'GET', '/api/sync/conflicts?status=unresolved');
    let resolved = 0;
    for (const conflict of conflicts) {
      const res = await apiCall(officer, 'POST', `/api/sync/conflicts/${conflict.conflict_id}/resolve`, { resolution: 'keep_server' });
      if (res.success) resolved += 1;
    }
    await a.call('sync');
    await b.call('sync');
    const server = await serverSchoolState(schoolId);
    const locals = await Promise.all([a, b].map((d) => d.call('local', { schoolId })));
    const convergence = locals.map((local, i) => ({
      device: ['A', 'B'][i],
      feeding: Object.keys(differences(local.feeding, server.feeding)).length === 0,
      enrolment: Object.keys(differences(local.enrolment, server.enrolment)).length === 0,
      noOpenConflicts: local.unresolvedConflicts === 0,
    }));

    const tp = rows.filter((r) => r.expected && r.observed).length;
    const fp = rows.filter((r) => !r.expected && r.observed).length;
    const tn = rows.filter((r) => !r.expected && !r.observed).length;
    const fn = rows.filter((r) => r.expected && !r.observed).length;
    return {
      name: 'school_conflicts',
      label: 'Conflicts on daily feeding and enrolment, resolved by the programme officer',
      operationsJudged: rows.length,
      confusion: { truePositive: tp, falsePositive: fp, trueNegative: tn, falseNegative: fn },
      accuracy: (tp + tn) / rows.length,
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
      byCase: [...FEEDING_CASES, ...ENROLMENT_CASES].map((c) => {
        const caseRows = rows.filter((r) => r.case === c.name && r.device === 'B');
        return {
          case: c.name, label: `${c.record === 'enrolment' ? 'Enrolment' : 'Daily feeding'}: ${c.label.replace(/^Both change /, 'both change ')}`,
          expectConflict: c.expectConflict, repetitions: caseRows.length,
          conflictsReported: caseRows.filter((r) => r.observed).length,
          correct: caseRows.filter((r) => r.observed === r.expected).length,
        };
      }),
      conflictsOnServer: conflicts.length,
      resolvedByOfficer: resolved,
      convergence,
      devicesConverged: convergence.filter((x) => x.feeding && x.enrolment && x.noOpenConflicts).length,
      mismatches: locals.map((local) => ({
        feeding: differences(local.feeding, server.feeding), enrolment: differences(local.enrolment, server.enrolment),
      })),
    };
  } finally {
    a.stop();
    b.stop();
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const pct = (x) => (x === null || x === undefined ? 'n/a' : `${(100 * x).toFixed(1)}%`);
const secs = (ms) => (ms === null || ms === undefined ? 'n/a' : `${(ms / 1000).toFixed(2)} s`);

function table(rows, headers) {
  return [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

function profileText(p) {
  const parts = [`${p.delayMs} ms per request`];
  if (p.dropRequest) parts.push(`${pct(p.dropRequest)} of requests lost before the server`);
  if (p.dropResponse) parts.push(`${pct(p.dropResponse)} of responses lost after the server applied them`);
  return parts.join('; ');
}

function renderReport(r) {
  const L = [];
  L.push('# Synchronisation Evaluation Report\n');
  L.push('Generated by `frontend/evaluation/sync/run-sync-evaluation.js`.\n');
  L.push(`Run: ${r.generatedAt} · ${r.environment.node} · ${r.environment.platform} · ${secs(r.runtimeMs)} in total.\n`);
  L.push('Each simulated device is a separate process running the PWA\'s own code (local database, sync queue, '
    + 'sync manager and API client) against the real API and a throwaway PostgreSQL database. The app\'s own timings '
    + 'apply: after reconnecting it waits 5 s and sends its queue; while records are still waiting it retries '
    + 'automatically (5 s after a sync that got some through, then 15 s, 30 s, 1, 2 and 5 minutes while nothing does). '
    + 'A dropped connection does not count as a failed attempt; an operation the server rejects is marked failed '
    + `after 3 retries. The automatic sync is left alone for up to ${AUTOMATIC_SYNC_LIMIT_MS / 60000} minutes; users press "Sync now" (at most ${MAX_SYNC_NOW_PRESSES} times) only if records are still waiting after that.\n`);

  L.push('## 1. Sync success rate and latency\n');
  const capture = r.scenarios.filter((s) => s.records && s.kind !== 'school');
  L.push(table(capture.map((s) => [
    s.label, s.devices, s.records, `${s.onServerCorrect} (${pct(s.successRate)})`, s.missingOnServer, s.wrongValuesOnServer,
    s.appliedMoreThanOnce, s.stuckAsFailed, secs(s.latencyMs.median), secs(s.latencyMs.p95),
  ]), ['Scenario', 'Devices', 'Records', 'On the server, correct', 'Missing', 'Wrong numbers', 'Applied twice',
    'Stuck as failed', 'Median latency', '95th percentile']));
  L.push('\nSuccess rate = records on the server with exactly the numbers the device saved, out of all records captured. '
    + 'Latency = time from reconnecting until the device received the server\'s answer for that record, including the '
    + 'app\'s 5 s wait before syncing.\n');
  for (const s of capture) {
    L.push(`### ${s.label}\n`);
    L.push(`Network after reconnecting: ${profileText(s.profile)}.\n`);
    L.push(table(s.snapshots.map((x) => [x.after, x.synced, x.pending, x.failed, x.total]),
      ['After', 'Synced', 'Still waiting', 'Failed', 'Total']));
    L.push(`\nRequests: ${s.traffic.requests} (${s.traffic.syncRequests} reached the sync endpoint), `
      + `${s.traffic.droppedRequests} lost before the server, ${s.traffic.lostResponses} answers lost after the server applied them. `
      + `Conflicts raised: ${s.conflictsRaised}. Extra records on the server: ${s.extraRecordsOnServer}.\n`);
  }

  const c = r.scenarios.find((s) => s.name === 'conflicts');
  L.push('## 2. Conflict detection accuracy\n');
  L.push(`Two devices change records while offline; device A always syncs first. ${c.operationsJudged} operations `
    + 'are judged against the known answer (A\'s changes should never be conflicts).\n');
  L.push(table([[c.confusion.truePositive, c.confusion.falsePositive, c.confusion.trueNegative, c.confusion.falseNegative,
    pct(c.accuracy), pct(c.precision), pct(c.recall)]],
  ['True positives', 'False positives', 'True negatives', 'False negatives', 'Accuracy', 'Precision', 'Recall']));
  L.push('\nBy case (device B\'s change):\n');
  L.push(table(c.byCase.map((x) => [x.label, x.expectConflict ? 'Conflict' : 'No conflict', x.repetitions,
    x.conflictsReported, `${x.correct} of ${x.repetitions}`, `${x.serverValuesCorrect} of ${x.repetitions}`]),
  ['Case', 'Correct answer', 'Times', 'Conflicts reported', 'Judged correctly', 'Server numbers as expected']));
  L.push(`\nRecords with unexpected numbers on the server: ${c.recordsLost}. When a conflict is reported the server keeps `
    + 'the first device\'s numbers until an administrator decides, so nothing is overwritten.\n');
  const school = r.scenarios.filter((s) => s.kind === 'school');
  if (school.length) {
    L.push('## 3. Version 2: one school, two devices, a week offline\n');
    L.push('A kitchen tablet records 10 days of feeding and a store count; the office phone records the term\'s enrolment, '
      + 'two deliveries on one delivery note and a loss; the kitchen tablet also records the cereals delivery from the same '
      + 'note. After the automatic sync an administrator discards the held duplicate and both devices sync again. '
      + `${school[0].records} records (the plan said 21; with the store count it is 22).\n`);
    L.push(table(school.map((s) => [
      s.label, `${s.onServerCorrect} of ${s.records} (${pct(s.successRate)})`, s.appliedMoreThanOnce,
      s.duplicateHeld ? 'Yes' : 'No', s.duplicateInLedger ? 'Yes' : 'No',
      `${s.devicesConverged} of ${s.devices}`, `${s.serverCereals} kg / ${s.deviceCereals.join(' kg, ')} kg`,
      secs(s.latencyMs.median), secs(s.latencyMs.p95),
    ]), ['Network', 'On the server, correct', 'Applied twice', 'Duplicate note held', 'Duplicate in the ledger',
      'Devices converged', 'Cereals: server / devices', 'Median latency', '95th percentile']));
    L.push('\nConverged = the device holds exactly the server\'s feeding days, enrolment and stock entries, shows the same '
      + 'cereal balance, and has no open conflict, after its next download.\n');
  }

  const sc = r.scenarios.find((s) => s.name === 'school_conflicts');
  if (sc) {
    L.push('## 4. Version 2: conflicts on daily feeding and enrolment\n');
    L.push(`${sc.operationsJudged} operations judged; device A syncs first. Afterwards the programme officer resolved `
      + `${sc.resolvedByOfficer} of ${sc.conflictsOnServer} conflicts from the server's list (keeping the server's version) `
      + 'and both devices synced again.\n');
    L.push(table([[sc.confusion.truePositive, sc.confusion.falsePositive, sc.confusion.trueNegative, sc.confusion.falseNegative,
      pct(sc.accuracy), pct(sc.precision), pct(sc.recall), `${sc.devicesConverged} of 2`]],
    ['True positives', 'False positives', 'True negatives', 'False negatives', 'Accuracy', 'Precision', 'Recall', 'Devices converged']));
    L.push('\n');
    L.push(table(sc.byCase.map((x) => [x.label, x.expectConflict ? 'Conflict' : 'No conflict', x.repetitions,
      x.conflictsReported, `${x.correct} of ${x.repetitions}`]),
    ['Case', 'Correct answer', 'Times', 'Conflicts reported', 'Judged correctly']));
    L.push('');
  }
  return `${L.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const SCENARIOS = [
  { name: 'good_connection', label: 'Good connection', profile: { delayMs: 100 }, seedBase: 100 },
  { name: 'slow_connection', label: 'Slow connection (2G-like)', profile: { delayMs: 1200 }, seedBase: 200 },
  { name: 'flaky_connection', label: 'Flaky connection',
    profile: { delayMs: 300, dropRequest: 0.25, dropResponse: 0.1 }, seedBase: 300 },
];

// Version 2: one school, two devices
const SCHOOL_SCENARIOS = [
  { name: 'school_good', label: 'One school, two devices: good connection', profile: { delayMs: 100 }, seedBase: 500 },
  { name: 'school_flaky', label: 'One school, two devices: flaky connection',
    profile: { delayMs: 300, dropRequest: 0.25, dropResponse: 0.1 }, seedBase: 600 },
];

async function main() {
  const started = Date.now();
  console.log(`Setting up the throwaway database ${EVAL_DB} and API server on port ${PORT} ...`);
  await createDatabase();
  const server = startBackend();
  try {
    await waitForHealth();
    const scenarios = [];
    // --school-only runs version 2's scenarios alone (while working on them); reports come from full runs
    const schoolOnly = process.argv.includes('--school-only');
    for (const s of schoolOnly ? [] : SCENARIOS) {
      console.log(`Scenario: ${s.label} ...`);
      scenarios.push(await captureScenario(s));
    }
    if (!schoolOnly) {
      console.log('Scenario: conflicts with known answers ...');
      scenarios.push(await conflictScenario({ seedBase: 400 }));
    }
    for (const s of SCHOOL_SCENARIOS) {
      console.log(`Scenario: ${s.label} ...`);
      scenarios.push(await schoolDevicesScenario(s));
    }
    console.log('Scenario: conflicts on daily feeding and enrolment ...');
    scenarios.push(await schoolConflictScenario({ seedBase: 700 }));

    const result = {
      generatedAt: new Date().toISOString(),
      environment: { node: process.version, platform: `${process.platform} ${process.arch}` },
      runtimeMs: Date.now() - started,
      scenarios,
    };
    if (schoolOnly) {
      console.log(JSON.stringify(scenarios.map((x) => ({ name: x.name, convergence: x.convergence, mismatches: x.mismatches })), null, 1));
      return;
    }
    fs.mkdirSync(RESULTS, { recursive: true });
    fs.writeFileSync(path.join(RESULTS, 'sync_evaluation.json'), `${JSON.stringify(result, null, 2)}\n`);
    fs.writeFileSync(path.join(RESULTS, 'sync_evaluation_report.md'), renderReport(result));
    console.log(`Done in ${secs(result.runtimeMs)}. Wrote ${path.relative(FRONTEND, RESULTS)}/`);
  } finally {
    server.kill();
    await sleep(500);
    await dropDatabase();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
