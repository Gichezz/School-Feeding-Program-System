import { describe, expect, it } from 'vitest';
import { RECORD_STATES, recordStateFor } from './recordStates';

describe('recordStateFor', () => {
  it('maps each stored sync status to one record state', () => {
    expect(recordStateFor('pending')).toBe('local');
    expect(recordStateFor('synced')).toBe('sent');
    expect(recordStateFor('conflict')).toBe('waiting');
    expect(recordStateFor('held')).toBe('hold');
    expect(recordStateFor('failed')).toBe('retry');
  });

  it('treats a pending change with a failed attempt as one that will be retried', () => {
    expect(recordStateFor('pending', { errorMessage: 'Network error' })).toBe('retry');
  });

  it('treats an unknown status as saved on this device', () => {
    expect(recordStateFor(undefined)).toBe('local');
  });

  it('gives every state words and an icon', () => {
    for (const state of Object.values(RECORD_STATES)) {
      expect(state.label).toBeTruthy();
      expect(state.icon).toBeTruthy();
    }
  });
});
