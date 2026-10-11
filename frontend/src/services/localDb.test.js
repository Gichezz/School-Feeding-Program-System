import { describe, expect, it } from 'vitest';
import db, { getOrCreateClientId } from '../db/database';
import {
  cacheSchools,
  getCachedSchools,
  saveLocalAttendance,
  updateLocalAttendance,
  saveLocalMeal,
  updateLocalMeal,
  getLocalSyncStats,
} from './localDb';

const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';

const attendance = {
  schoolId: SCHOOL_ID,
  attendanceDate: '06-10-2026',
  totalRegistered: 100,
  totalPresent: 90,
  totalAbsent: 10,
};

const meal = {
  schoolId: SCHOOL_ID,
  distributionDate: '06-10-2026',
  mealsPrepared: 100,
  mealsServed: 90,
};

describe('client id', () => {
  it('is created once and reused', async () => {
    const first = await getOrCreateClientId();
    const second = await getOrCreateClientId();

    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
  });
});

describe('school cache', () => {
  it('keeps schools available offline', async () => {
    await cacheSchools([{ id: SCHOOL_ID, name: 'Demo Primary School' }]);

    const schools = await getCachedSchools();

    expect(schools).toEqual([expect.objectContaining({ id: SCHOOL_ID, name: 'Demo Primary School' })]);
  });
});

describe('saving attendance offline', () => {
  it('stores the record as pending at version 1 with the device client id', async () => {
    const saved = await saveLocalAttendance(attendance);

    const stored = await db.attendance.get(saved.id);
    expect(stored).toMatchObject({
      ...attendance,
      version: 1,
      syncStatus: 'pending',
      clientId: await getOrCreateClientId(),
    });
  });

  it('queues a create operation with the record payload', async () => {
    const saved = await saveLocalAttendance(attendance);

    const queue = await db.syncQueue.toArray();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      entityType: 'attendance',
      recordId: saved.id,
      operation: 'create',
      payload: attendance,
      baseVersion: 0,
      status: 'pending',
      retryCount: 0,
    });
  });
});

describe('editing attendance offline', () => {
  it('bumps the version and queues an update based on the previous version', async () => {
    const saved = await saveLocalAttendance(attendance);
    await db.syncQueue.clear();

    await updateLocalAttendance(saved.id, { totalPresent: 85, totalAbsent: 15 });

    expect(await db.attendance.get(saved.id)).toMatchObject({ totalPresent: 85, version: 2, syncStatus: 'pending' });
    const [operation] = await db.syncQueue.toArray();
    expect(operation).toMatchObject({
      operation: 'update',
      baseVersion: 1,
      payload: { ...attendance, totalPresent: 85, totalAbsent: 15 },
    });
  });

  it('does not queue anything when only recording a successful sync', async () => {
    const saved = await saveLocalAttendance(attendance);
    await db.syncQueue.clear();

    await updateLocalAttendance(saved.id, { syncStatus: 'synced', version: 1 });

    expect(await db.attendance.get(saved.id)).toMatchObject({ syncStatus: 'synced', version: 1 });
    expect(await db.syncQueue.count()).toBe(0);
  });
});

describe('meal distributions offline', () => {
  it('stores the record as pending and queues a create operation', async () => {
    const saved = await saveLocalMeal(meal);

    expect(await db.mealDistribution.get(saved.id)).toMatchObject({ ...meal, version: 1, syncStatus: 'pending' });
    const [operation] = await db.syncQueue.toArray();
    expect(operation).toMatchObject({ entityType: 'mealDistribution', operation: 'create', payload: meal, baseVersion: 0 });
  });

  it('queues an update with the full record when edited', async () => {
    const saved = await saveLocalMeal(meal);
    await db.syncQueue.clear();

    await updateLocalMeal(saved.id, { mealsServed: 95 });

    const [operation] = await db.syncQueue.toArray();
    expect(operation).toMatchObject({ operation: 'update', baseVersion: 1, payload: { ...meal, mealsServed: 95 } });
  });
});

describe('local sync statistics', () => {
  it('counts records waiting to be synchronized', async () => {
    await saveLocalAttendance(attendance);
    await saveLocalMeal(meal);

    const stats = await getLocalSyncStats();

    expect(stats).toEqual({ total: 2, pending: 2, synced: 0, failed: 0, conflict: 0 });
  });
});
