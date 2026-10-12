import { describe, expect, it } from 'vitest';
import { syncStateFor } from './useSyncStatus';

const base = { isOnline: true, syncing: false, failedCount: 0, conflictCount: 0 };

describe('syncStateFor', () => {
  it('is synced when nothing needs attention', () => {
    expect(syncStateFor(base)).toBe('synced');
  });

  it('shows a conflict instead of "synced" while one waits for a decision', () => {
    expect(syncStateFor({ ...base, conflictCount: 1 })).toBe('conflict');
  });

  it('puts a conflict before failed changes, which retry by themselves', () => {
    expect(syncStateFor({ ...base, conflictCount: 1, failedCount: 2 })).toBe('conflict');
    expect(syncStateFor({ ...base, failedCount: 2 })).toBe('failed');
  });

  it('reports being offline or syncing first, whatever else is waiting', () => {
    expect(syncStateFor({ ...base, isOnline: false, conflictCount: 1 })).toBe('offline');
    expect(syncStateFor({ ...base, syncing: true, conflictCount: 1 })).toBe('syncing');
  });
});
