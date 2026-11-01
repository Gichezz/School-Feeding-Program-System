/**
 * One simulated school device for the sync evaluation (#72). Run by run-sync-evaluation.js
 * as a separate process (with vite-node, so the PWA's modules load exactly as in the app)
 * and controlled over IPC. Records are saved and synced through the app's own code:
 * localDb (save/edit + sync queue), syncManager (manual and automatic sync) and the API client.
 */
import { network, outcomes, seededRandom, traffic } from './environment.js';

const api = await import('../../src/services/api.js');
const session = await import('../../src/services/session.js');
const localDb = await import('../../src/services/localDb.js');
const syncManager = await import('../../src/sync/syncManager.js');
const { default: db } = await import('../../src/db/database.js');
const feedingDb = await import('../../src/services/feedingDb.js');
const { saveDeviceIdentity } = await import('../../src/features/devices/deviceIdentity.js');
const { stockBalances } = await import('../../src/features/feeding/planning.js');

// Automatic sync when the connection returns, as the app sets it up in App.jsx
syncManager.setupAutoSync();

let reconnectedAt = null;

const KINDS = {
  attendance: {
    table: () => db.attendance,
    dateField: 'attendanceDate',
    save: localDb.saveLocalAttendance,
    update: localDb.updateLocalAttendance,
  },
  meals: {
    table: () => db.mealDistribution,
    dateField: 'distributionDate',
    save: localDb.saveLocalMeal,
    update: localDb.updateLocalMeal,
  },
};

const commands = {
  async init({ baseUrl, email, password, seed, register = false }) {
    network.baseUrl = baseUrl;
    network.random = seededRandom(seed);
    session.saveSession(await api.login(email, password));
    const { schools } = await api.getSchools();
    await localDb.cacheSchools(schools);
    // A school device (version 2 scenarios): it downloads the school's records with every sync
    if (register) await saveDeviceIdentity({ schoolId: schools[0].id, status: 'approved' });
    return { schoolId: schools[0].id };
  },

  /** The daily feeding form: saves the day, or edits this device's copy of it. */
  async feeding(values) {
    await feedingDb.saveDailyFeeding(values);
    return { ok: true };
  },

  /** One class and sex on the enrolment page. */
  async enrolment(values) {
    await feedingDb.saveEnrolment(values);
    return { ok: true };
  },

  /** A delivery, purchase or loss, or a store count, as the Stock page records them. */
  async movement(values) {
    return feedingDb.addStockMovement(values);
  },

  async count(values) {
    return feedingDb.addStockCount(values);
  },

  /** What this device holds: its records, its stock entries and the cereal balance it shows. */
  async local({ schoolId }) {
    const school = await db.schoolSettings.get(schoolId);
    const feedingDays = await db.dailyFeeding.filter((d) => d.schoolId === schoolId).toArray();
    const movements = (await db.stockMovements.where('schoolId').equals(schoolId).toArray())
      .filter((m) => !(m.syncStatus === 'held' && m.heldReason === 'duplicate_delivery'));
    return {
      feeding: Object.fromEntries(feedingDays.map((d) => [d.feedingDate, [d.learnersFed, Number(d.cerealsKg), Number(d.pulsesKg)]])),
      enrolment: Object.fromEntries((await db.enrolment.toArray()).map((e) => [`${e.class}|${e.sex}`, e.learners])),
      movementIds: movements.map((m) => m.id).sort(),
      countIds: (await db.stockCounts.toArray()).map((c) => c.id).sort(),
      cereals: stockBalances({ movements, feedingDays, ration: school?.ration }).cereals,
      unresolvedConflicts: await db.conflicts.where('status').equals('unresolved').count(),
    };
  },

  /**
   * Save a record as the Attendance or Meals page does: edit this device's copy of the
   * day if it has one, otherwise save a new record (both queue a sync operation).
   */
  async record({ kind, schoolId, date, values, lateReason }) {
    const type = KINDS[kind];
    const existing = await type.table().where(type.dateField).equals(date).first();
    if (existing) {
      await type.update(existing.id, { ...values, ...(lateReason && { lateReason }) });
    } else {
      await type.save({ schoolId, [type.dateField]: date, ...values, ...(lateReason && { lateReason }) });
    }
    return { action: existing ? 'edit' : 'new' };
  },

  /** Change the connection; the browser fires "offline" and "online" events. */
  async network({ mode, delayMs = 0, dropRequest = 0, dropResponse = 0 }) {
    const wasOffline = network.mode === 'offline';
    Object.assign(network, { mode, delayMs, dropRequest, dropResponse });
    if (!wasOffline && mode === 'offline') window.dispatchEvent(new Event('offline'));
    if (wasOffline && mode !== 'offline') {
      reconnectedAt = performance.now();
      window.dispatchEvent(new Event('online'));
    }
    return { mode };
  },

  /** The "Sync now" button, pressed once any automatic sync already running has finished. */
  async sync() {
    while (syncManager.isSyncInProgress()) await new Promise((resolve) => setTimeout(resolve, 50));
    return syncManager.manualSync();
  },

  /** The sync queue, with when each operation's final answer arrived after reconnecting. */
  async state() {
    const operations = await db.syncQueue.toArray();
    return {
      reconnectedAt,
      syncing: syncManager.isSyncInProgress(),
      traffic: { ...traffic },
      operations: operations.map((op) => ({
        id: op.id,
        entityType: op.entityType,
        operation: op.operation,
        date: op.payload.attendanceDate || op.payload.distributionDate || op.payload.feedingDate || op.payload.movementDate || null,
        // What the record is about: its date, or the class and sex for enrolment
        key: op.payload.class ? `${op.payload.class}|${op.payload.sex}` : op.payload.feedingDate || null,
        status: op.status,
        retryCount: op.retryCount || 0,
        outcome: outcomes.get(op.id)?.status || null,
        answeredAfterMs: outcomes.has(op.id) && reconnectedAt !== null
          ? outcomes.get(op.id).receivedAt - reconnectedAt
          : null,
      })),
      conflicts: (await db.conflicts.toArray()).map((c) => ({ operationId: c.operationId, status: c.status })),
    };
  },
};

process.on('message', async ({ id, command, args }) => {
  try {
    process.send({ id, ok: true, result: await commands[command](args || {}) });
  } catch (error) {
    process.send({ id, ok: false, error: error.message });
  }
});

process.send({ ready: true });
