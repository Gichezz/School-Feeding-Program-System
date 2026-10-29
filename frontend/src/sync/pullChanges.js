import db from '../db/database';
import { getChanges } from '../services/api';

/**
 * Download the school's changes since this device's last download and store them, so
 * every device at a school has the same records and stock ledger.
 *
 * A downloaded record never replaces a local one with changes still to send: the local
 * edit stays and is sent on the next sync, where the server decides (a stale edit
 * becomes a conflict for review). Nothing is lost on either side.
 */

const UNSENT = new Set(['pending', 'conflict', 'held']);

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
    [db.enrolment, db.dailyFeeding, db.stockMovements, db.stockCounts, db.terms, db.calendarEvents, db.schoolSettings, db.syncCursors],
    async () => {
      await db.schoolSettings.put(changes.school);
      // Reference data comes whole with every download
      await db.terms.clear();
      await db.terms.bulkPut(changes.terms);
      await db.calendarEvents.clear();
      await db.calendarEvents.bulkPut(changes.calendarEvents);

      for (const row of changes.enrolment) {
        await storeVersioned('enrolment', row, (r) => db.enrolment
          .where('[schoolId+termId+class+sex]').equals([r.schoolId, r.termId, r.class, r.sex]).first());
      }
      for (const row of changes.dailyFeeding) {
        await storeVersioned('dailyFeeding', row, (r) => db.dailyFeeding
          .where('[schoolId+feedingDate]').equals([r.schoolId, r.feedingDate]).first());
      }
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
