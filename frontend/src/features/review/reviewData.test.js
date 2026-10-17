import { describe, expect, it } from 'vitest';
import { flagSummaryRows, historyChanges } from './reviewData';

const flag = {
  entityType: 'attendance',
  values: { date: '07-10-2026', registered: 100, present: 90, absent: 10 },
  capturedBy: 'Grace Wanjiru',
  device: 'Office tablet',
  capturedAt: '2026-10-07T17:30:00.000Z',
  receivedAt: '2026-10-08T06:00:00.000Z',
  lateReason: null,
};

describe('flagSummaryRows', () => {
  it('shows the numbers, who captured it, the device and both times', () => {
    const rows = flagSummaryRows(flag);

    expect(rows.map((r) => r.label)).toEqual(['Registered', 'Present', 'Absent', 'Captured by', 'Device', 'Captured', 'Reached the server']);
    expect(rows.find((r) => r.key === 'present').value).toBe('90');
  });

  it('adds the late reason, and explains missing capture details', () => {
    const rows = flagSummaryRows({ ...flag, entityType: 'meal_distribution', values: { prepared: 120, served: 110 }, capturedBy: null, device: null, capturedAt: null, lateReason: 'Register was at the head office' });

    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ['Meals prepared', '120'],
      ['Meals served', '110'],
      ['Captured by', 'Not recorded'],
      ['Device', 'Not a school device'],
      ['Captured', 'Not recorded'],
      ['Reached the server', expect.any(String)],
      ['Reason for late entry', 'Register was at the head office'],
    ]);
  });
});

describe('historyChanges', () => {
  it('lists what changed in each version', () => {
    const history = [
      { version: 1, values: { registered: 100, present: 90, absent: 10 }, changedBy: 'Grace', device: 'Office tablet', changedAt: '2026-10-07T06:00:00Z' },
      { version: 2, values: { registered: 100, present: 85, absent: 15 }, changedBy: 'Grace', device: 'Office tablet', changedAt: '2026-10-07T07:00:00Z' },
      { version: 3, values: { registered: 100, present: 85, absent: 15 }, changedBy: null, device: null, changedAt: '2026-10-07T08:00:00Z' },
    ];

    expect(historyChanges(history).map(({ version, first, changes, changedBy }) => ({ version, first, changes, changedBy }))).toEqual([
      { version: 1, first: true, changes: [], changedBy: 'Grace' },
      { version: 2, first: false, changes: ['Present 90 → 85', 'Absent 10 → 15'], changedBy: 'Grace' },
      { version: 3, first: false, changes: [], changedBy: 'Unknown' },
    ]);
  });
});
