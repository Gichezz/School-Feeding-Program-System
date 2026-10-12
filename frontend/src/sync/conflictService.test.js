import { describe, expect, it, vi } from 'vitest';
import db from '../db/database';
import { resolveConflict as apiResolveConflict } from '../services/api';
import { resolveConflict, saveConflict, getUnresolvedConflicts } from './conflictService';

vi.mock('../services/api', () => ({
  resolveConflict: vi.fn(),
  getConflicts: vi.fn(),
}));

const attendance = {
  schoolId: '11111111-1111-1111-1111-111111111111',
  attendanceDate: '06-10-2026',
  totalRegistered: 100,
  totalPresent: 80,
  totalAbsent: 20,
};

/**
 * A local record and queue operation in the state the sync manager leaves them after a conflict.
 */
async function seedConflict() {
  const recordId = await db.attendance.add({ ...attendance, version: 2, syncStatus: 'conflict' });
  await db.syncQueue.add({ id: 'op-3', entityType: 'attendance', recordId, operation: 'update', status: 'conflict', retryCount: 0 });
  const saved = await saveConflict({
    operationId: 'op-3',
    entityType: 'attendance',
    recordId,
    baseVersion: 1,
    serverVersion: 2,
    localPayload: attendance,
    serverRecord: { version: 2, total_present: 88 },
    conflictId: 'server-conflict-id',
  });
  return { recordId, localConflictId: saved.id };
}

function serverResolution(resolution, record) {
  return { success: true, conflictId: 'server-conflict-id', resolution, version: record.version, record };
}

describe('saveConflict', () => {
  it('stores one unresolved conflict per operation', async () => {
    await seedConflict();
    await saveConflict({ operationId: 'op-3', entityType: 'attendance', conflictId: 'server-conflict-id' });

    expect(await getUnresolvedConflicts()).toHaveLength(1);
  });
});

describe('resolveConflict', () => {
  it('keep_server: sends the server conflict id and applies the server values locally', async () => {
    const { recordId, localConflictId } = await seedConflict();
    apiResolveConflict.mockResolvedValue(serverResolution('keep_server', {
      version: 2, total_registered: 100, total_present: 88, total_absent: 12,
    }));

    const result = await resolveConflict(localConflictId, 'keep_server');

    expect(apiResolveConflict).toHaveBeenCalledWith('server-conflict-id', { resolution: 'keep_server', clientId: expect.any(String) });
    expect(result).toMatchObject({ success: true, resolution: 'keep_server', version: 2 });
    expect(await db.attendance.get(recordId)).toMatchObject({ totalPresent: 88, totalAbsent: 12, version: 2, syncStatus: 'synced' });
  });

  it('keep_local: records the new server version for the local values', async () => {
    const { recordId, localConflictId } = await seedConflict();
    apiResolveConflict.mockResolvedValue(serverResolution('keep_local', {
      version: 3, total_registered: 100, total_present: 80, total_absent: 20,
    }));

    await resolveConflict(localConflictId, 'keep_local');

    expect(await db.attendance.get(recordId)).toMatchObject({ totalPresent: 80, version: 3, syncStatus: 'synced' });
  });

  it('merge: sends the edited values and applies the merged record locally', async () => {
    const { recordId, localConflictId } = await seedConflict();
    const values = { totalRegistered: 100, totalPresent: 84, totalAbsent: 16 };
    apiResolveConflict.mockResolvedValue(serverResolution('merge', {
      version: 3, total_registered: 100, total_present: 84, total_absent: 16,
    }));

    await resolveConflict(localConflictId, 'merge', values);

    expect(apiResolveConflict).toHaveBeenCalledWith('server-conflict-id', { resolution: 'merge', clientId: expect.any(String), values });
    expect(await db.attendance.get(recordId)).toMatchObject({ totalPresent: 84, totalAbsent: 16, version: 3, syncStatus: 'synced' });
    expect(await db.conflicts.get(localConflictId)).toMatchObject({ status: 'resolved', resolution: 'merge' });
  });

  it('marks the conflict resolved and the queued operation done, without queueing new work', async () => {
    const { localConflictId } = await seedConflict();
    apiResolveConflict.mockResolvedValue(serverResolution('keep_server', { version: 2, total_registered: 100, total_present: 88, total_absent: 12 }));

    await resolveConflict(localConflictId, 'keep_server');

    expect(await db.conflicts.get(localConflictId)).toMatchObject({ status: 'resolved', resolution: 'keep_server', resolvedAt: expect.any(String) });
    expect(await db.syncQueue.get('op-3')).toMatchObject({ status: 'synced' });
    expect(await db.syncQueue.count()).toBe(1);
  });

  it('leaves the conflict unresolved when the server refuses', async () => {
    const { localConflictId } = await seedConflict();
    apiResolveConflict.mockRejectedValue(new Error('Stale conflict'));

    await expect(resolveConflict(localConflictId, 'keep_local')).rejects.toThrow('Stale conflict');

    expect(await db.conflicts.get(localConflictId)).toMatchObject({ status: 'unresolved' });
  });

  it('rejects an unknown local conflict', async () => {
    await expect(resolveConflict(999, 'keep_local')).rejects.toThrow('Conflict not found locally');
    expect(apiResolveConflict).not.toHaveBeenCalled();
  });
});
