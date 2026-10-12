import { describe, expect, it } from 'vitest';
import {
  changeFrom,
  dailyTotals,
  isInRange,
  previousRange,
  summarise,
  toAttendanceRow,
  toMealRow,
} from './insightsData';
import { toCsv } from './exportCsv';

const names = { s1: 'Kibera Primary' };

describe('isInRange and previousRange', () => {
  const range = { start: '06-10-2026', end: '12-10-2026' };

  it('includes both ends of the range', () => {
    expect(isInRange('06-10-2026', range)).toBe(true);
    expect(isInRange('12-10-2026', range)).toBe(true);
    expect(isInRange('2026-10-09', range)).toBe(true);
    expect(isInRange('05-10-2026', range)).toBe(false);
    expect(isInRange('13-10-2026', range)).toBe(false);
  });

  it('gives the period of the same length just before', () => {
    expect(previousRange(range)).toEqual({ start: '29-09-2026', end: '05-10-2026' });
    expect(previousRange({ start: '12-10-2026', end: '12-10-2026' })).toEqual({ start: '11-10-2026', end: '11-10-2026' });
  });
});

describe('record rows', () => {
  it('reads device and server attendance records the same way', () => {
    const device = toAttendanceRow({ id: 1, syncStatus: 'pending', schoolId: 's1', attendanceDate: '12-10-2026', totalRegistered: 40, totalPresent: 36, totalAbsent: 4 }, names);
    const server = toAttendanceRow({ id: 'a', school_id: 's1', attendance_date: '12-10-2026', total_registered: '40', total_present: '36', total_absent: '4' }, names);
    expect(device).toMatchObject({ date: '12-10-2026', schoolName: 'Kibera Primary', registered: 40, present: 36, absent: 4, unsynced: true });
    expect(server).toMatchObject({ date: '12-10-2026', schoolName: 'Kibera Primary', registered: 40, present: 36, absent: 4, unsynced: false });
  });

  it('works out meal waste as prepared minus served', () => {
    const row = toMealRow({ id: 2, syncStatus: 'synced', schoolId: 's1', distributionDate: '12-10-2026', mealsPrepared: 120, mealsServed: 112 }, names);
    expect(row).toMatchObject({ prepared: 120, served: 112, waste: 8, unsynced: false });
  });
});

describe('summarise and dailyTotals', () => {
  const attendance = [
    { date: '12-10-2026', schoolName: 'A', registered: 40, present: 30, absent: 10 },
    { date: '12-10-2026', schoolName: 'B', registered: 60, present: 60, absent: 0 },
    { date: '11-10-2026', schoolName: 'A', registered: 40, present: 20, absent: 20 },
  ];
  const meals = [
    { date: '12-10-2026', schoolName: 'A', prepared: 100, served: 90, waste: 10 },
    { date: '10-10-2026', schoolName: 'A', prepared: 50, served: 50, waste: 0 },
  ];

  it('adds up the period', () => {
    expect(summarise(attendance, meals)).toEqual({
      registered: 140, present: 110, absent: 30, rate: 110 / 140,
      prepared: 150, served: 140, waste: 10, attendanceRecords: 3, mealRecords: 2,
    });
  });

  it('has no rate when nobody is registered', () => {
    expect(summarise([], []).rate).toBeNull();
  });

  it('groups by date, oldest first, with every school added together', () => {
    const days = dailyTotals(attendance, meals);
    expect(days.map((d) => d.date)).toEqual(['10-10-2026', '11-10-2026', '12-10-2026']);
    expect(days[2]).toMatchObject({ registered: 100, present: 90, rate: 90, prepared: 100, served: 90, waste: 10 });
    expect(days[0].rate).toBeNull();
  });
});

describe('changeFrom', () => {
  it('describes a change and whether it is good', () => {
    expect(changeFrom(120, 100)).toEqual({ value: '+20', direction: 'up', good: true, label: 'vs previous period' });
    expect(changeFrom(5, 8, { higherIsGood: false })).toMatchObject({ value: '−3', direction: 'down', good: true });
    expect(changeFrom(0.9, 0.85, { points: true })).toMatchObject({ value: '+5.0 pts', direction: 'up' });
    expect(changeFrom(10, 10)).toMatchObject({ value: 'No change', direction: 'flat' });
  });

  it('shows nothing when there is nothing to compare with', () => {
    expect(changeFrom(10, null)).toBeUndefined();
    expect(changeFrom(null, 0.5)).toBeUndefined();
  });
});

describe('toCsv', () => {
  it('writes a header and quotes cells that need it', () => {
    const csv = toCsv(
      [{ school: 'St. Mary\'s, Kisumu', note: 'said "hi"', count: 3 }],
      [
        { header: 'School', value: (r) => r.school },
        { header: 'Note', value: (r) => r.note },
        { header: 'Count', value: (r) => r.count },
      ]
    );
    expect(csv).toBe('School,Note,Count\r\n"St. Mary\'s, Kisumu","said ""hi""",3');
  });
});
