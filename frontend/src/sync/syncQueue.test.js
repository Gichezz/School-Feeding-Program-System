import { describe, expect, it, vi } from 'vitest';
import db from '../db/database';
import {
  addToSyncQueue,
  getPendingOperations,
  markOperationSynced,
  markOperationFailed,
  markOperationConflict,
  incrementRetryCount,
  getSyncQueueStats,
} from './syncQueue';

function queue(overrides = {}) {
  return addToSyncQueue({
    entityType: 'attendance',
    recordId: 1,
    operation: 'create',
    payload: { totalPresent: 90 },
    ...overrides,
  });
}

describe('addToSyncQueue', () => {
  it('stores a pending operation with a unique id and default base version', async () => {
    const first = await queue();
    const second = await queue();

    expect(first.id).not.toBe(second.id);
    expect(await db.syncQueue.get(first.id)).toMatchObject({
      entityType: 'attendance',
      operation: 'create',
      baseVersion: 0,
      status: 'pending',
      retryCount: 0,
      errorMessage: null,
    });
  });
});

describe('operation order', () => {
  it('returns operations queued in the same millisecond in the order they were made', async () => {
    // A create and its edit saved in one click share a millisecond; the edit must
    // still come back after the create, whatever the random part of the id is.
    vi.spyOn(Date, 'now').mockReturnValue(1795553770791);
    const made = [];
    for (let i = 0; i < 20; i += 1) {
      made.push((await queue({ recordId: i, operation: i === 0 ? 'create' : 'update' })).id);
    }

    const pending = await getPendingOperations();

    expect(pending.map((op) => op.id)).toEqual(made);
  });
});

describe('queue status changes', () => {
  it('lists only pending operations', async () => {
    const pending = await queue();
    const synced = await queue();
    await markOperationSynced(synced.id);

    const result = await getPendingOperations();

    expect(result.map((op) => op.id)).toEqual([pending.id]);
  });

  it('marks an operation as synced', async () => {
    const op = await queue();

    await markOperationSynced(op.id);

    expect(await db.syncQueue.get(op.id)).toMatchObject({ status: 'synced', lastAttemptAt: expect.any(String) });
  });

  it('increments the retry count and keeps the operation pending', async () => {
    const op = await queue();

    await incrementRetryCount(op.id, 'Network error');
    await incrementRetryCount(op.id, 'Network error');

    expect(await db.syncQueue.get(op.id)).toMatchObject({ status: 'pending', retryCount: 2, errorMessage: 'Network error' });
  });

  it('marks an operation as failed with a numeric retry count', async () => {
    const op = await queue();
    await incrementRetryCount(op.id, 'Network error');

    await markOperationFailed(op.id, 'Gave up');

    expect(await db.syncQueue.get(op.id)).toMatchObject({ status: 'failed', retryCount: 2, errorMessage: 'Gave up' });
  });

  it('marks an operation as a conflict and keeps the conflict details', async () => {
    const op = await queue();

    await markOperationConflict(op.id, { message: 'Version mismatch', conflictId: 'c-1' });

    expect(await db.syncQueue.get(op.id)).toMatchObject({
      status: 'conflict',
      errorMessage: 'Version mismatch',
      conflictData: { conflictId: 'c-1' },
    });
  });

  it('reports counts per status', async () => {
    await queue();
    const synced = await queue();
    const conflict = await queue();
    await markOperationSynced(synced.id);
    await markOperationConflict(conflict.id, {});

    expect(await getSyncQueueStats()).toEqual({ total: 3, pending: 1, synced: 1, failed: 0, conflict: 1 });
  });
});
