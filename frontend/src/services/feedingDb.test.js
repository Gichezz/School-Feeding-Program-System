import { describe, expect, it } from 'vitest';
import db from '../db/database';
import { addStockMovement, saveDailyFeeding, saveEnrolment } from './feedingDb';

const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';
const TERM_ID = '22222222-2222-4222-8222-222222222222';

const day = {
  schoolId: SCHOOL_ID,
  feedingDate: '06-10-2026',
  feedingHappened: true,
  learnersFed: 400,
  cerealsKg: 60,
  pulsesKg: 16,
};

describe('saveDailyFeeding', () => {
  it('saves a new day on the device and queues it as a create', async () => {
    const saved = await saveDailyFeeding(day);

    expect(await db.dailyFeeding.get(saved.id)).toMatchObject({ ...day, version: 1, syncStatus: 'pending' });
    expect(await db.syncQueue.toArray()).toEqual([expect.objectContaining({
      entityType: 'dailyFeeding', recordId: saved.id, operation: 'create', payload: day, baseVersion: 0,
    })]);
  });

  it('edits the same day instead of adding a second record, queueing an update on its version', async () => {
    const first = await saveDailyFeeding(day);

    await saveDailyFeeding({ ...day, learnersFed: 395, cerealsKg: 59.25 });

    expect(await db.dailyFeeding.count()).toBe(1);
    expect(await db.dailyFeeding.get(first.id)).toMatchObject({ learnersFed: 395, version: 2 });
    const update = (await db.syncQueue.toArray()).find((op) => op.operation === 'update');
    expect(update).toMatchObject({ operation: 'update', baseVersion: 1, recordId: first.id });
  });

  it('edits a day downloaded from another device on its server version', async () => {
    const id = await db.dailyFeeding.add({ ...day, serverId: 'server-record', version: 3, syncStatus: 'synced' });

    await saveDailyFeeding({ ...day, learnersFed: 390 });

    expect((await db.syncQueue.toArray())[0]).toMatchObject({ operation: 'update', recordId: id, baseVersion: 3 });
  });
});

describe('saveEnrolment', () => {
  it('keeps one record per class and sex in a term', async () => {
    const entry = { schoolId: SCHOOL_ID, termId: TERM_ID, class: 'Grade 4', sex: 'F', learners: 52 };
    await saveEnrolment(entry);
    await saveEnrolment({ ...entry, sex: 'M', learners: 49 });

    await saveEnrolment({ ...entry, learners: 53 });

    const rows = await db.enrolment.toArray();
    expect(rows.map((r) => [r.sex, r.learners, r.version])).toEqual([['F', 53, 2], ['M', 49, 1]]);
  });
});

describe('addStockMovement', () => {
  it('gives each entry its own id and queues it, never as an edit', async () => {
    const delivery = { schoolId: SCHOOL_ID, movementDate: '05-10-2026', commodity: 'cereals', kind: 'delivery', quantityKg: 500, reference: 'DN-2026-114' };

    const a = await addStockMovement(delivery);
    const b = await addStockMovement(delivery);

    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.id).not.toBe(b.id);
    const queue = await db.syncQueue.toArray();
    expect(queue.map((op) => [op.entityType, op.operation, op.recordId])).toEqual([
      ['stockMovement', 'create', a.id],
      ['stockMovement', 'create', b.id],
    ]);
    expect(queue[0].payload).toEqual({ ...delivery, id: a.id });
  });
});
