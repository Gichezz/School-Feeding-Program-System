import db from '../db/database';
import { addToSyncQueue } from '../sync/syncQueue';

/**
 * The school's feeding records and stock ledger on this device. Everything is saved
 * here first and queued for sync, so it works without a connection; records from other
 * devices at the school arrive with each download (sync/pullChanges.js).
 *
 *   enrolment, dailyFeeding  one record per key (school, term, class and sex; school
 *                            and date). Saving again for the same key edits the record.
 *   stockMovements, stockCounts  append-only: each entry gets an id made here and is
 *                            never changed; a mistake is corrected by a reversing entry.
 */

// changeReason: why a class that was verified changed (admission, transfer or correction)
const ENROLMENT_FIELDS = ['schoolId', 'termId', 'class', 'sex', 'learners', 'changeReason'];
const FEEDING_FIELDS = ['schoolId', 'feedingDate', 'feedingHappened', 'learnersPresent', 'learnersFed',
  'cerealsKg', 'pulsesKg', 'reasonCode', 'note', 'lateReason'];

function pick(values, fields) {
  return Object.fromEntries(fields.filter((f) => values[f] !== undefined).map((f) => [f, values[f]]));
}

/**
 * Save a versioned record: a new one is queued as a create; an existing one (captured
 * here or downloaded) is edited and queued as an update based on its current version.
 */
async function saveVersioned(table, entityType, existing, values, local = {}) {
  const now = new Date().toISOString();
  return db.transaction('rw', db[table], db.syncQueue, db.metadata, async () => {
    if (!existing) {
      const record = { ...values, version: 1, syncStatus: 'pending', createdAt: now, updatedAt: now };
      const id = await db[table].add(record);
      await addToSyncQueue({ entityType, recordId: id, operation: 'create', payload: values, baseVersion: 0 });
      return { ...record, id };
    }
    const record = { ...existing, ...values, ...local, version: existing.version + 1, syncStatus: 'pending', updatedAt: now };
    await db[table].put(record);
    await addToSyncQueue({ entityType, recordId: existing.id, operation: 'update', payload: values, baseVersion: existing.version });
    return record;
  });
}

export async function saveEnrolment(values) {
  const fields = pick(values, ENROLMENT_FIELDS);
  const existing = await db.enrolment
    .where('[schoolId+termId+class+sex]').equals([fields.schoolId, fields.termId, fields.class, fields.sex]).first();
  // A changed number is no longer verified; the last verified number (verifiedLearners)
  // stays for the term plan until the officer checks the new one
  const local = existing && existing.learners !== fields.learners ? { verified: false } : {};
  return saveVersioned('enrolment', 'enrolment', existing, fields, local);
}

export async function saveDailyFeeding(values) {
  const fields = pick(values, FEEDING_FIELDS);
  const existing = await db.dailyFeeding.where('[schoolId+feedingDate]').equals([fields.schoolId, fields.feedingDate]).first();
  return saveVersioned('dailyFeeding', 'dailyFeeding', existing, fields);
}

async function addEntry(table, entityType, values) {
  const entry = { ...values, id: crypto.randomUUID() };
  return db.transaction('rw', db[table], db.syncQueue, db.metadata, async () => {
    await db[table].add({ ...entry, syncStatus: 'pending', createdAt: new Date().toISOString() });
    await addToSyncQueue({ entityType, recordId: entry.id, operation: 'create', payload: entry, baseVersion: 0 });
    return entry;
  });
}

/** A delivery, purchase, loss, return or reversal. Returns the entry with its new id. */
export function addStockMovement(values) {
  return addEntry('stockMovements', 'stockMovement', values);
}

/** A physical count of one commodity in the store. */
export function addStockCount(values) {
  return addEntry('stockCounts', 'stockCount', values);
}

export function getEnrolment(schoolId, termId) {
  return db.enrolment.where('[schoolId+termId]').equals([schoolId, termId]).toArray();
}

export function getDailyFeeding(schoolId) {
  return db.dailyFeeding.filter((r) => r.schoolId === schoolId).toArray();
}

export function getStockMovements(schoolId) {
  return db.stockMovements.where('schoolId').equals(schoolId).toArray();
}

export function getStockCounts(schoolId) {
  return db.stockCounts.where('schoolId').equals(schoolId).toArray();
}

export function getTerms() {
  return db.terms.toArray();
}

export function getCalendarEvents() {
  return db.calendarEvents.toArray();
}

export function getSchoolSettings(schoolId) {
  return db.schoolSettings.get(schoolId);
}
