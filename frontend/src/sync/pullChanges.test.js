import { describe, expect, it, vi } from 'vitest';
import db from '../db/database';
import { getChanges } from '../services/api';
import { addStockMovement, saveDailyFeeding } from '../services/feedingDb';
import { applyChanges, pullChanges } from './pullChanges';

vi.mock('../services/api', () => ({
  getChanges: vi.fn(),
}));

const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';

function download(overrides = {}) {
  return {
    cursor: '1200',
    school: { id: SCHOOL_ID, name: 'Demo Primary School', ration: { cereals: 150, pulses: 40, oil: 5, salt: 2 } },
    terms: [{ id: 't-3', year: 2026, term: 3, opensOn: '24-08-2026', closesOn: '23-10-2026' }],
    calendarEvents: [{ id: 'e-1', startsOn: '20-10-2026', endsOn: '20-10-2026', kind: 'public_holiday', name: 'Mashujaa Day' }],
    enrolment: [],
    dailyFeeding: [],
    stockMovements: [],
    stockCounts: [],
    ...overrides,
  };
}

const serverDay = {
  serverId: 'server-day-1', schoolId: SCHOOL_ID, feedingDate: '06-10-2026', feedingHappened: true,
  learnersFed: 400, cerealsKg: 60, pulsesKg: 16, version: 1,
};

describe('applyChanges', () => {
  it('stores the school settings, calendar and records, and the cursor', async () => {
    await applyChanges(SCHOOL_ID, download({
      dailyFeeding: [serverDay],
      stockMovements: [{ id: 'm-1', schoolId: SCHOOL_ID, movementDate: '05-10-2026', commodity: 'cereals', kind: 'delivery', quantityKg: 500 }],
    }));

    expect(await db.schoolSettings.get(SCHOOL_ID)).toMatchObject({ ration: { cereals: 150 } });
    expect(await db.terms.count()).toBe(1);
    expect(await db.calendarEvents.count()).toBe(1);
    expect(await db.dailyFeeding.toArray()).toEqual([expect.objectContaining({ ...serverDay, syncStatus: 'synced' })]);
    expect(await db.stockMovements.get('m-1')).toMatchObject({ quantityKg: 500, syncStatus: 'synced' });
    expect(await db.syncCursors.get(SCHOOL_ID)).toMatchObject({ cursor: '1200' });
  });

  it('updates a record to a newer server version', async () => {
    await applyChanges(SCHOOL_ID, download({ dailyFeeding: [serverDay] }));

    await applyChanges(SCHOOL_ID, download({ dailyFeeding: [{ ...serverDay, learnersFed: 395, version: 2 }] }));

    expect(await db.dailyFeeding.toArray()).toEqual([expect.objectContaining({ learnersFed: 395, version: 2 })]);
  });

  it('never replaces a local record with changes still to send', async () => {
    await saveDailyFeeding({ schoolId: SCHOOL_ID, feedingDate: '06-10-2026', feedingHappened: true, learnersFed: 410, cerealsKg: 61.5, pulsesKg: 16.4 });

    await applyChanges(SCHOOL_ID, download({ dailyFeeding: [serverDay] }));

    expect(await db.dailyFeeding.toArray()).toEqual([expect.objectContaining({ learnersFed: 410, syncStatus: 'pending' })]);
  });

  it('recognises a day this device recorded once it comes back from the server', async () => {
    const local = await saveDailyFeeding({ ...serverDay, serverId: undefined, version: undefined });
    await db.dailyFeeding.update(local.id, { syncStatus: 'synced', serverId: 'server-day-1' });

    await applyChanges(SCHOOL_ID, download({ dailyFeeding: [serverDay] }));

    expect(await db.dailyFeeding.count()).toBe(1);
  });
});

describe('pullChanges', () => {
  it('asks for everything the first time, then for changes since the last cursor', async () => {
    getChanges.mockResolvedValueOnce(download({ cursor: '1200', dailyFeeding: [serverDay] }));
    getChanges.mockResolvedValueOnce(download({ cursor: '1300' }));

    const first = await pullChanges(SCHOOL_ID);
    await pullChanges(SCHOOL_ID);

    expect(first).toBe(1);
    expect(getChanges.mock.calls.map(([args]) => args)).toEqual([
      { schoolId: SCHOOL_ID, since: '0' },
      { schoolId: SCHOOL_ID, since: '1200' },
    ]);
  });
});

describe('conflicts resolved elsewhere', () => {
  const day = { schoolId: SCHOOL_ID, feedingDate: '06-10-2026', feedingHappened: true, learnersFed: 380, cerealsKg: 57, pulsesKg: 15.2 };

  /** This device's create came back as a conflict; optionally an edit was made after it. */
  async function inConflict({ editAfter = false } = {}) {
    const local = await saveDailyFeeding(day);
    const [create] = await db.syncQueue.toArray();
    await db.syncQueue.update(create.id, { status: 'conflict' });
    await db.dailyFeeding.update(local.id, { syncStatus: 'conflict' });
    await db.conflicts.add({ operationId: create.id, entityType: 'dailyFeeding', recordId: local.id, conflictId: 'c-1', status: 'unresolved' });
    if (editAfter) await saveDailyFeeding({ ...day, learnersFed: 385, cerealsKg: 57.75 });
    return { local, create };
  }

  function decided(create, resolution, record) {
    return download({
      resolvedConflicts: [{ conflictId: 'c-1', operationId: create.id, entityType: 'dailyFeeding', resolution, record }],
      dailyFeeding: [record],
    });
  }

  it('closes the conflict and takes the server copy when nothing else is waiting', async () => {
    const { local, create } = await inConflict();

    await applyChanges(SCHOOL_ID, decided(create, 'keep_server', { ...serverDay, version: 1 }));

    expect(await db.conflicts.toArray()).toEqual([expect.objectContaining({ status: 'resolved', resolution: 'keep_server' })]);
    expect(await db.syncQueue.get(create.id)).toMatchObject({ status: 'synced' });
    expect(await db.dailyFeeding.get(local.id)).toMatchObject({ learnersFed: 400, serverId: 'server-day-1', version: 1, syncStatus: 'synced' });
  });

  it("re-bases a later edit on the new version after keeping the device's version", async () => {
    const { local } = await inConflict({ editAfter: true });
    const queue = await db.syncQueue.toArray();
    const [create, edit] = ['create', 'update'].map((kind) => queue.find((op) => op.operation === kind));

    await applyChanges(SCHOOL_ID, decided(create, 'keep_local', { ...serverDay, learnersFed: 380, version: 2 }));

    expect(await db.syncQueue.get(edit.id)).toMatchObject({ status: 'pending', baseVersion: 2 });
    expect(await db.dailyFeeding.get(local.id)).toMatchObject({ learnersFed: 385, serverId: 'server-day-1', version: 3, syncStatus: 'pending' });
  });

  it("leaves a later edit as it was after keeping the server's version, so it is reviewed again", async () => {
    const { local } = await inConflict({ editAfter: true });
    const queue = await db.syncQueue.toArray();
    const [create, edit] = ['create', 'update'].map((kind) => queue.find((op) => op.operation === kind));

    await applyChanges(SCHOOL_ID, decided(create, 'keep_server', { ...serverDay, version: 1 }));

    expect(await db.syncQueue.get(edit.id)).toMatchObject({ status: 'pending', baseVersion: 1 });
    expect(await db.dailyFeeding.get(local.id)).toMatchObject({ learnersFed: 385, serverId: 'server-day-1', syncStatus: 'pending' });
  });
});

describe('decisions on held records', () => {
  const note = { schoolId: SCHOOL_ID, movementDate: '05-10-2026', commodity: 'cereals', kind: 'delivery', quantityKg: 500, reference: 'DN-2026-114' };

  async function heldEntry() {
    const entry = await addStockMovement(note);
    const [op] = await db.syncQueue.toArray();
    await db.syncQueue.update(op.id, { status: 'held', heldReason: 'duplicate_delivery' });
    await db.stockMovements.update(entry.id, { syncStatus: 'held' });
    return { entry, op };
  }

  it('drops a discarded duplicate delivery, so it leaves the stock balance', async () => {
    const { entry, op } = await heldEntry();

    await applyChanges(SCHOOL_ID, download({
      heldDecisions: [{ operationId: op.id, entityType: 'stockMovement', decision: 'discarded', id: entry.id, record: null }],
    }));

    expect(await db.stockMovements.get(entry.id)).toBeUndefined();
    expect(await db.syncQueue.get(op.id)).toMatchObject({ status: 'synced', heldDecision: 'discarded' });
  });

  it('keeps an applied entry as the server sent it', async () => {
    const { entry, op } = await heldEntry();

    await applyChanges(SCHOOL_ID, download({
      heldDecisions: [{ operationId: op.id, entityType: 'stockMovement', decision: 'applied', id: entry.id, record: null }],
      stockMovements: [{ ...note, id: entry.id }],
    }));

    expect(await db.stockMovements.get(entry.id)).toMatchObject({ quantityKg: 500, syncStatus: 'synced' });
  });

  it("takes the server's copy of a feeding record whose held change was discarded", async () => {
    await saveDailyFeeding({ schoolId: SCHOOL_ID, feedingDate: '06-10-2026', feedingHappened: true, learnersFed: 410, cerealsKg: 61.5, pulsesKg: 16.4 });
    const [op] = await db.syncQueue.toArray();
    await db.syncQueue.update(op.id, { status: 'held' });

    await applyChanges(SCHOOL_ID, download({
      heldDecisions: [{ operationId: op.id, entityType: 'dailyFeeding', decision: 'discarded', id: null, record: serverDay }],
    }));

    expect(await db.dailyFeeding.toArray()).toEqual([expect.objectContaining({ learnersFed: 400, syncStatus: 'synced' })]);
  });
});
