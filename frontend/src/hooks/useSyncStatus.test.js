import { describe, expect, it } from 'vitest';
import { pausedReasonFor, syncStateFor } from './useSyncStatus';

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

  it('never says synced while the sign-in has expired: sending is paused', () => {
    expect(syncStateFor({ ...base, pausedReason: 'signIn' })).toBe('paused');
    expect(syncStateFor({ ...base, pausedReason: 'deviceRemoved', conflictCount: 1, failedCount: 1 })).toBe('paused');
  });

  it('says offline rather than paused when there is no connection', () => {
    expect(syncStateFor({ ...base, isOnline: false, pausedReason: 'signIn' })).toBe('offline');
  });
});

describe('pausedReasonFor', () => {
  it('has no reason while the session is valid or nobody is signed in', () => {
    expect(pausedReasonFor({ token: 't' }, true)).toBeNull();
    expect(pausedReasonFor(null, false)).toBeNull();
  });

  it('asks for a new sign-in when the session expired', () => {
    expect(pausedReasonFor({ token: 't' }, false)).toBe('signIn');
  });

  it('asks for the device to be set up again when it was removed', () => {
    expect(pausedReasonFor({ token: 't', endedReason: 'deviceRevoked' }, false)).toBe('deviceRemoved');
  });
});
