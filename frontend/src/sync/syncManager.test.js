import { afterEach, describe, expect, it, vi } from 'vitest';
import db from '../db/database';
import { saveLocalAttendance, updateLocalAttendance } from '../services/localDb';
import { syncOperations } from '../services/api';
import { processSyncQueue } from './syncManager';

vi.mock('../services/api', () => ({
  syncOperations: vi.fn(),
}));

const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';
const attendance = {
  schoolId: SCHOOL_ID,
  attendanceDate: '06-10-2026',
  totalRegistered: 100,
  totalPresent: 90,
  totalAbsent: 10,
};

function serverResult(result) {
  return { success: true, results: [result] };
}

function synced(operationId, version) {
  return serverResult({ success: true, operationId, status: 'synced', version, recordId: 'server-record-id' });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('processSyncQueue', () => {
  it('does nothing while the device is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await saveLocalAttendance(attendance);

    const result = await processSyncQueue();

    expect(result).toMatchObject({ success: false, message: 'Cannot sync while offline' });
    expect(syncOperations).not.toHaveBeenCalled();
    expect((await db.syncQueue.toArray())[0].status).toBe('pending');
  });

  it('sends queued operations and marks them and their records as synced', async () => {
    const saved = await saveLocalAttendance(attendance);
    const [operation] = await db.syncQueue.toArray();
    syncOperations.mockResolvedValue(synced(operation.id, 1));

    const result = await processSyncQueue();

    expect(result.progress).toMatchObject({ total: 1, successful: 1 });
    expect(syncOperations).toHaveBeenCalledWith({
      clientId: expect.any(String),
      operations: [expect.objectContaining({ id: operation.id, entityType: 'attendance', operation: 'create', payload: attendance, baseVersion: 0 })],
    });
    expect(await db.syncQueue.get(operation.id)).toMatchObject({ status: 'synced' });
    expect(await db.attendance.get(saved.id)).toMatchObject({ syncStatus: 'synced', version: 1 });
  });

  it('keeps a failed operation pending and counts the retry', async () => {
    await saveLocalAttendance(attendance);
    syncOperations.mockRejectedValue(new Error('Network error'));

    await processSyncQueue();

    const [operation] = await db.syncQueue.toArray();
    expect(operation).toMatchObject({ status: 'pending', retryCount: 1, errorMessage: 'Network error' });
  });

  it('marks an operation as failed once retries are used up, and still syncs the rest', async () => {
    await saveLocalAttendance(attendance);
    await saveLocalAttendance({ ...attendance, attendanceDate: '07-10-2026' });
    const [first, second] = await db.syncQueue.toArray();
    await db.syncQueue.update(first.id, { retryCount: 3 });
    syncOperations.mockImplementation(async ({ operations }) =>
      operations[0].id === first.id ? Promise.reject(new Error('Network error')) : synced(second.id, 1)
    );

    const result = await processSyncQueue();

    expect(result.success).toBe(true);
    expect(await db.syncQueue.get(first.id)).toMatchObject({ status: 'failed', retryCount: 4 });
    expect(await db.syncQueue.get(second.id)).toMatchObject({ status: 'synced' });
  });

  describe('when the server reports a conflict', () => {
    async function syncIntoConflict() {
      const saved = await saveLocalAttendance(attendance);
      syncOperations.mockResolvedValueOnce(synced((await db.syncQueue.toArray())[0].id, 1));
      await processSyncQueue();

      // Offline edit based on version 1, while the server has moved on to version 2
      await updateLocalAttendance(saved.id, { totalPresent: 80, totalAbsent: 20 });
      const update = (await db.syncQueue.where('status').equals('pending').toArray())[0];
      const serverRecord = { id: 'server-record-id', version: 2, total_present: 88 };
      syncOperations.mockResolvedValueOnce(serverResult({
        success: false,
        operationId: update.id,
        status: 'conflict',
        message: 'Version mismatch',
        conflictId: 'server-conflict-id',
        serverRecord,
        baseVersion: 1,
        serverVersion: 2,
        localPayload: update.payload,
      }));
      await processSyncQueue();
      return { saved, update, serverRecord };
    }

    it('marks the operation as a conflict', async () => {
      const { update } = await syncIntoConflict();

      expect(await db.syncQueue.get(update.id)).toMatchObject({ status: 'conflict' });
    });

    it('stores the conflict locally with the server conflict id and both versions', async () => {
      const { update, serverRecord } = await syncIntoConflict();

      const [conflict] = await db.conflicts.toArray();
      expect(conflict).toMatchObject({
        operationId: update.id,
        conflictId: 'server-conflict-id',
        baseVersion: 1,
        serverVersion: 2,
        localPayload: update.payload,
        serverRecord,
        status: 'unresolved',
      });
    });

    it('flags the local record without editing it or queueing another update', async () => {
      const { saved } = await syncIntoConflict();

      expect(await db.attendance.get(saved.id)).toMatchObject({ syncStatus: 'conflict', version: 2, totalPresent: 80 });
      expect(await db.syncQueue.where('status').equals('pending').count()).toBe(0);
    });

    it('does not send anything on the next sync', async () => {
      await syncIntoConflict();
      syncOperations.mockClear();

      await processSyncQueue();

      expect(syncOperations).not.toHaveBeenCalled();
    });
  });
});
