import { describe, expect, it } from 'vitest';
import { APPROVAL_CHECK_MS, MAX_APPROVAL_CHECK_MS, nextCheckDelay } from './useDeviceApproval';

describe('how often a waiting device asks whether it is approved', () => {
  it('asks every 15 seconds while the server answers', () => {
    expect(nextCheckDelay(APPROVAL_CHECK_MS, true)).toBe(15000);
    expect(nextCheckDelay(MAX_APPROVAL_CHECK_MS, true)).toBe(15000);
  });

  it('waits twice as long after each check with no answer, up to 2 minutes', () => {
    let delay = APPROVAL_CHECK_MS;
    const delays = [];
    for (let i = 0; i < 5; i += 1) {
      delay = nextCheckDelay(delay, false);
      delays.push(delay);
    }

    expect(delays).toEqual([30000, 60000, 120000, 120000, 120000]);
  });
});
