import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../db/database';
import { saveLocalAttendance, updateLocalAttendance } from '../services/localDb';
import { syncOperations } from '../services/api';
import { isSyncInProgress, processSyncQueue, setupAutoSync } from './syncManager';
import { requeueConnectionFailures } from './syncQueue';
import { saveSession, clearSession, isSessionValid } from '../services/session';

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

function serverError(status, message) {
  return Object.assign(new Error(message), { status });
}

function synced(operationId, version) {
  return serverResult({ success: true, operationId, status: 'synced', version, recordId: 'server-record-id' });
}

beforeEach(() => {
  saveSession({
    token: 'test-token',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    user: { id: 'u-1', name: 'School Feeding Officer', role: 'school_staff' },
  });
});

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
    expect(await db.attendance.get(saved.id)).toMatchObject({ syncStatus: 'synced', version: 1, serverId: 'server-record-id' });
  });

  it('keeps an operation the server could not apply pending and counts the retry', async () => {
    await saveLocalAttendance(attendance);
    syncOperations.mockRejectedValue(serverError(500, 'Internal server error'));

    await processSyncQueue();

    const [operation] = await db.syncQueue.toArray();
    expect(operation).toMatchObject({ status: 'pending', retryCount: 1, errorMessage: 'Internal server error' });
  });

  it('marks an operation as failed once retries are used up, and still syncs the rest', async () => {
    await saveLocalAttendance(attendance);
    await saveLocalAttendance({ ...attendance, attendanceDate: '07-10-2026' });
    const [first, second] = await db.syncQueue.toArray();
    await db.syncQueue.update(first.id, { retryCount: 3 });
    syncOperations.mockImplementation(async ({ operations }) =>
      operations[0].id === first.id ? Promise.reject(serverError(500, 'Internal server error')) : synced(second.id, 1)
    );

    const result = await processSyncQueue();

    expect(result.success).toBe(true);
    expect(await db.syncQueue.get(first.id)).toMatchObject({ status: 'failed', retryCount: 4 });
    expect(await db.syncQueue.get(second.id)).toMatchObject({ status: 'synced' });
  });

  describe('when the user needs to sign in again', () => {
    it('does not contact the server without a valid session and keeps records queued', async () => {
      clearSession();
      await saveLocalAttendance(attendance);

      const result = await processSyncQueue();

      expect(result).toMatchObject({ success: false, authRequired: true });
      expect(syncOperations).not.toHaveBeenCalled();
      expect((await db.syncQueue.toArray())[0]).toMatchObject({ status: 'pending', retryCount: 0 });
    });

    it('stops when the server rejects the session, without counting a retry', async () => {
      await saveLocalAttendance(attendance);
      await saveLocalAttendance({ ...attendance, attendanceDate: '07-10-2026' });
      syncOperations.mockRejectedValue(Object.assign(new Error('Session expired, please sign in again'), { status: 401 }));

      const result = await processSyncQueue();

      expect(result).toMatchObject({ success: false, authRequired: true });
      expect(syncOperations).toHaveBeenCalledTimes(1);
      const queue = await db.syncQueue.toArray();
      expect(queue.map((op) => [op.status, op.retryCount])).toEqual([['pending', 0], ['pending', 0]]);
    });

    it('resumes once a valid session is back', async () => {
      clearSession();
      await saveLocalAttendance(attendance);
      await processSyncQueue();
      saveSession({ token: 'new-token', expiresAt: new Date(Date.now() + 60_000).toISOString(), user: { role: 'school_staff' } });
      const [operation] = await db.syncQueue.toArray();
      syncOperations.mockResolvedValue(synced(operation.id, 1));

      const result = await processSyncQueue();

      expect(isSessionValid()).toBe(true);
      expect(result.progress).toMatchObject({ successful: 1 });
    });
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

describe('records tied to who captured them (#61)', () => {
  beforeEach(() => {
    saveSession({
      token: 'peter-token',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      user: { id: 'user-peter', name: 'Peter Otieno', role: 'school_staff', deviceId: 'device-1' },
    });
  });

  it('queues each record with who captured it, on which device and when, and sends that', async () => {
    await saveLocalAttendance(attendance);
    const [operation] = await db.syncQueue.toArray();
    syncOperations.mockResolvedValue(synced(operation.id, 1));

    await processSyncQueue();

    expect(operation).toMatchObject({ capturedBy: 'user-peter', capturedByName: 'Peter Otieno', deviceId: 'device-1', capturedAt: expect.any(String) });
    expect(syncOperations.mock.calls.at(-1)[0].operations[0]).toMatchObject({ capturedBy: 'user-peter', deviceId: 'device-1', capturedAt: operation.capturedAt });
  });

  it('leaves a colleague’s record waiting, without counting a retry', async () => {
    await saveLocalAttendance(attendance);
    const [operation] = await db.syncQueue.toArray();
    syncOperations.mockResolvedValue(serverResult({ success: false, operationId: operation.id, status: 'deferred' }));

    const result = await processSyncQueue();

    expect(result.progress).toMatchObject({ deferred: 1 });
    expect(await db.syncQueue.get(operation.id)).toMatchObject({ status: 'pending', retryCount: 0 });
  });

  it('stops sending a held record, and forgets the person’s offline sign-in when the server says so', async () => {
    await db.offlineUsers.put({ userId: 'user-mary', email: 'mary@example.org', deviceId: 'device-1' });
    const saved = await saveLocalAttendance(attendance);
    const [operation] = await db.syncQueue.toArray();
    syncOperations.mockResolvedValue(serverResult({ success: false, operationId: operation.id, status: 'held', reason: 'user_deactivated', capturedBy: 'user-mary' }));

    const result = await processSyncQueue();

    expect(result.progress).toMatchObject({ held: 1 });
    expect(await db.syncQueue.get(operation.id)).toMatchObject({ status: 'held', heldReason: 'user_deactivated' });
    expect((await db.attendance.get(saved.id)).syncStatus).toBe('held');
    expect(await db.offlineUsers.get('user-mary')).toBeUndefined();
  });
});

describe('dropped connections and automatic retries (#74)', () => {
  it('keeps a record waiting without using up a retry when the connection drops', async () => {
    await saveLocalAttendance(attendance);
    syncOperations.mockRejectedValue(new Error('Network error - unable to connect to server'));

    const result = await processSyncQueue();

    expect(result.progress).toMatchObject({ waiting: 1, failed: 0 });
    const [operation] = await db.syncQueue.toArray();
    expect(operation).toMatchObject({ status: 'pending', retryCount: 0, errorMessage: 'Network error - unable to connect to server' });
  });

  it('treats a gateway error while the server restarts as a dropped connection', async () => {
    await saveLocalAttendance(attendance);
    syncOperations.mockRejectedValue(serverError(503, 'Service unavailable'));

    await processSyncQueue();

    expect((await db.syncQueue.toArray())[0]).toMatchObject({ status: 'pending', retryCount: 0 });
  });

  it('stops trying after three dropped connections in a row, leaving everything waiting', async () => {
    for (const day of ['05', '06', '07', '08', '09']) {
      await saveLocalAttendance({ ...attendance, attendanceDate: `${day}-10-2026` });
    }
    syncOperations.mockRejectedValue(new Error('Network error - unable to connect to server'));

    await processSyncQueue();

    expect(syncOperations).toHaveBeenCalledTimes(3);
    const operations = await db.syncQueue.toArray();
    expect(operations.every((op) => op.status === 'pending' && op.retryCount === 0)).toBe(true);
  });

  it('puts records that older versions stranded after dropped connections back in the queue', async () => {
    await saveLocalAttendance(attendance);
    await saveLocalAttendance({ ...attendance, attendanceDate: '07-10-2026' });
    const [stranded, rejected] = await db.syncQueue.toArray();
    await db.syncQueue.update(stranded.id, { status: 'failed', retryCount: 4, errorMessage: 'Network error - unable to connect to server' });
    await db.syncQueue.update(rejected.id, { status: 'failed', retryCount: 4, errorMessage: 'Validation failed' });

    expect(await requeueConnectionFailures()).toBe(1);

    expect(await db.syncQueue.get(stranded.id)).toMatchObject({ status: 'pending', retryCount: 0 });
    expect(await db.syncQueue.get(rejected.id)).toMatchObject({ status: 'failed' });
  });

  it('retries automatically while records wait: soon after progress, later when nothing gets through', async () => {
    vi.stubGlobal('window', new EventTarget());
    const realSetTimeout = globalThis.setTimeout;
    const scheduled = [];
    const timers = vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms, ...args) => {
      if (ms >= 5000) {
        scheduled.push({ fn, ms });
        return scheduled.length;
      }
      return realSetTimeout(fn, ms, ...args);
    });
    const runNextRetry = async () => {
      const { fn, ms } = scheduled.shift();
      fn();
      await vi.waitFor(() => expect(isSyncInProgress()).toBe(false));
      return ms;
    };
    const stop = setupAutoSync();
    try {
      await saveLocalAttendance(attendance);
      await saveLocalAttendance({ ...attendance, attendanceDate: '07-10-2026' });
      const [first, second] = await db.syncQueue.toArray();
      const dropped = () => Promise.reject(new Error('Network error - unable to connect to server'));
      syncOperations.mockImplementation(({ operations }) => (operations[0].id === first.id ? synced(first.id, 1) : dropped()));
      await vi.waitFor(() => expect(scheduled).toHaveLength(1));

      // Opening the app syncs after 5 s: one record gets through, so try again soon
      expect(await runNextRetry()).toBe(5000);
      expect(scheduled.map((t) => t.ms)).toEqual([5000]);
      // Nothing gets through this time: wait longer
      expect(await runNextRetry()).toBe(5000);
      expect(scheduled.map((t) => t.ms)).toEqual([15000]);
      // The connection is back: the last record syncs and no more retries are planned
      syncOperations.mockImplementation(async () => synced(second.id, 1));
      expect(await runNextRetry()).toBe(15000);
      expect(scheduled).toEqual([]);
      expect(await db.syncQueue.get(second.id)).toMatchObject({ status: 'synced', retryCount: 0 });
    } finally {
      stop();
      timers.mockRestore();
    }
  });
});
