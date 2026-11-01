import db from '../db/database';
import { getChanges } from '../services/api';

/**
 * Download the school's changes since this device's last download and store them, so
 * every device at a school has the same records and stock ledger.
 *
 * A downloaded record never replaces a local one with changes still to send: the local
 * edit stays and is sent on the next sync, where the server decides (a stale edit
 * becomes a conflict for review). Nothing is lost on either side.
 *
 * Conflicts resolved since the last download (by anyone, on any computer) close the
 * device's copy of the conflict and release the changes held back behind it. After
 * "keep the device's version" those later changes are re-based on the new server
 * version, because they were made on top of the values that were kept. After "keep the
 * server's version" or a merge they are sent as they are and come back as a new
 * conflict: a later edit never silently overwrites someone's decision.
 *
 * Records the server held for a person to decide (for example the same delivery note
 * entered on two devices) are settled the same way: once applied, the server's copy
 * arrives with the download; once discarded, the device drops its stock entry, or takes
 * the server's copy of an editable record, so a discarded duplicate leaves its stock
 * balance.
 */

const UNSENT = new Set(['pending', 'conflict', 'held']);

const RECORD_TABLES = { enrolment: 'enrolment', dailyFeeding: 'dailyFeeding' };
const ENTRY_TABLES = { stockMovement: 'stockMovements', stockCount: 'stockCounts' };

function findByKey(name, r) {
  return name === 'enrolment'
    ? db.enrolment.where('[schoolId+termId+class+sex]').equals([r.schoolId, r.termId, r.class, r.sex]).first()
    : db.dailyFeeding.where('[schoolId+feedingDate]').equals([r.schoolId, r.feedingDate]).first();
}

/** Apply one resolved conflict to this device's copy. */
async function applyResolution(resolved) {
  const table = RECORD_TABLES[resolved.entityType];
  const { record } = resolved;
  const now = new Date().toISOString();

  const localConflicts = await db.conflicts.filter((c) => c.conflictId === resolved.conflictId || c.operationId === resolved.operationId).toArray();
  for (const c of localConflicts) {
    await db.conflicts.update(c.id, { status: 'resolved', resolution: resolved.resolution, resolvedAt: now });
  }
  // The change that caused the conflict is settled, whichever way it was decided
  const operation = await db.syncQueue.get(resolved.operationId);
  if (operation) await db.syncQueue.update(operation.id, { status: 'synced', resolution: resolved.resolution });
  if (!table || !record) return;

  const local = operation?.recordId !== undefined
    ? await db[table].get(operation.recordId)
    : (await db[table].where('serverId').equals(record.serverId).first()) || (await findByKey(resolved.entityType, record));
  if (!local) return;

  const waiting = (await db.syncQueue.where('recordId').equals(local.id).toArray())
    .filter((op) => op.entityType === resolved.entityType && op.status === 'pending')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (waiting.length === 0) {
    await db[table].put({ ...local, ...record, id: local.id, syncStatus: 'synced' });
    return;
  }
  if (resolved.resolution === 'keep_local') {
    for (const [i, op] of waiting.entries()) await db.syncQueue.update(op.id, { baseVersion: record.version + i });
  }
  await db[table].update(local.id, {
    serverId: record.serverId,
    syncStatus: 'pending',
    ...(resolved.resolution === 'keep_local' && { version: record.version + waiting.length }),
  });
}

/** Apply one decision on a record the server held. */
async function applyHeldDecision(decided) {
  const operation = await db.syncQueue.get(decided.operationId);
  if (operation) await db.syncQueue.update(operation.id, { status: 'synced', heldDecision: decided.decision });

  const entryTable = ENTRY_TABLES[decided.entityType];
  if (entryTable) {
    // An applied entry arrives with this download; a discarded one never counted on the server
    if (decided.decision === 'discarded' && decided.id) await db[entryTable].delete(decided.id);
    return;
  }
  const table = RECORD_TABLES[decided.entityType];
  if (!table || operation?.recordId === undefined) return;
  const local = await db[table].get(operation.recordId);
  if (!local) return;
  const stillWaiting = (await db.syncQueue.where('recordId').equals(local.id).toArray())
    .some((op) => op.entityType === decided.entityType && op.status === 'pending');
  if (stillWaiting) return;
  if (decided.decision === 'applied') {
    // Free the local copy so the downloaded server copy replaces it
    await db[table].update(local.id, { syncStatus: 'synced' });
  } else if (decided.record) {
    await db[table].put({ ...local, ...decided.record, id: local.id, syncStatus: 'synced' });
  } else {
    await db[table].delete(local.id);
  }
}

/**
 * Store a downloaded editable record. Matches by server id, then by its key, so a record
 * this device created before it synced is recognised.
 */
async function storeVersioned(table, row, findByKey) {
  const { serverId } = row;
  const local = (await db[table].where('serverId').equals(serverId).first()) || (await findByKey(row));
  if (local && UNSENT.has(local.syncStatus)) return;
  if (local && local.serverId === serverId && local.version >= row.version) return;
  await db[table].put({ ...local, ...row, ...(local && { id: local.id }), syncStatus: 'synced' });
}

async function storeEntry(table, row) {
  // An entry is never changed, so the local copy (if any) is the same entry
  await db[table].put({ ...(await db[table].get(row.id)), ...row, syncStatus: 'synced' });
}

/**
 * Apply one download response. Exported for tests.
 */
export async function applyChanges(schoolId, changes) {
  await db.transaction('rw',
    [db.enrolment, db.dailyFeeding, db.stockMovements, db.stockCounts, db.terms, db.calendarEvents, db.schoolSettings,
      db.syncCursors, db.syncQueue, db.conflicts],
    async () => {
      await db.schoolSettings.put(changes.school);
      // Reference data comes whole with every download
      await db.terms.clear();
      await db.terms.bulkPut(changes.terms);
      await db.calendarEvents.clear();
      await db.calendarEvents.bulkPut(changes.calendarEvents);

      // Decisions first, so records released from a conflict take the downloaded copy
      for (const resolved of changes.resolvedConflicts || []) await applyResolution(resolved);
      for (const decided of changes.heldDecisions || []) await applyHeldDecision(decided);

      for (const row of changes.enrolment) await storeVersioned('enrolment', row, (r) => findByKey('enrolment', r));
      for (const row of changes.dailyFeeding) await storeVersioned('dailyFeeding', row, (r) => findByKey('dailyFeeding', r));
      for (const row of changes.stockMovements) await storeEntry('stockMovements', row);
      for (const row of changes.stockCounts) await storeEntry('stockCounts', row);

      await db.syncCursors.put({ schoolId, cursor: changes.cursor, downloadedAt: new Date().toISOString() });
    });
}

/**
 * Download and store the school's changes. Returns the number of records received.
 */
export async function pullChanges(schoolId) {
  const saved = await db.syncCursors.get(schoolId);
  const changes = await getChanges({ schoolId, since: saved?.cursor ?? '0' });
  await applyChanges(schoolId, changes);
  return changes.enrolment.length + changes.dailyFeeding.length + changes.stockMovements.length + changes.stockCounts.length;
}
