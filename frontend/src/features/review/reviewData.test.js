import { describe, expect, it } from 'vitest';
import { flagSummaryRows, historyChanges, recordHeading } from './reviewData';

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

    expect(rows.map((r) => r.label)).toEqual(['Registered', 'Present', 'Absent', 'Captured by', 'Device', 'Captured', 'Received']);
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
      ['Received', expect.any(String)],
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

describe('the new records', () => {
  const base = { capturedBy: 'Grace Wanjiru', device: 'Kitchen tablet', capturedAt: null, receivedAt: null };

  it('heads and lists a daily feeding record with kilograms', () => {
    const day = { ...base, entityType: 'daily_feeding', values: { date: '06-10-2026', happened: true, present: null, fed: 400, cerealsKg: 90, pulsesKg: 16 } };

    expect(recordHeading(day)).toBe('Daily feeding · 06-10-2026');
    expect(flagSummaryRows(day).slice(0, 3)).toEqual([
      { key: 'fed', label: 'Learners fed', value: '400' },
      { key: 'cerealsKg', label: 'Cereals issued', value: '90 kg' },
      { key: 'pulsesKg', label: 'Pulses issued', value: '16 kg' },
    ]);
  });

  it('heads a short delivery and an enrolment count', () => {
    expect(recordHeading({ entityType: 'stock_movement', values: { date: '05-10-2026', kind: 'delivery', commodity: 'cereals' } }))
      .toBe('Delivery of cereals · 05-10-2026');
    expect(recordHeading({ entityType: 'enrolment', values: { class: 'Grade 4', sex: 'F', term: 'Term 3 2026' } }))
      .toBe('Enrolment · Grade 4 girls, Term 3 2026');
  });

  it('lists what changed in a feeding record', () => {
    const [, second] = historyChanges([
      { version: 1, values: { fed: 400, cerealsKg: 60 } },
      { version: 2, values: { fed: 380, cerealsKg: 57.5 } },
    ]);

    expect(second.changes).toEqual(['Learners fed 400 → 380', 'Cereals issued 60 kg → 57.5 kg']);
  });
});
