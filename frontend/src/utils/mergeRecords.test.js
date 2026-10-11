import { describe, expect, it } from 'vitest';
import { mergeLocalAndServerRecords } from './mergeRecords';

const SCHOOL = '11111111-1111-1111-1111-111111111111';
const fields = { localDateField: 'attendanceDate', serverDateField: 'attendance_date' };

describe('mergeLocalAndServerRecords', () => {
  it('drops the server copy of a record stored on the device by server id', () => {
    const local = [{ id: 1, serverId: 'srv-1', schoolId: SCHOOL, attendanceDate: '08-10-2026', totalPresent: 80 }];
    const server = [{ id: 'srv-1', school_id: SCHOOL, attendance_date: '08-10-2026', total_present: 95 }];

    expect(mergeLocalAndServerRecords(local, server, fields)).toEqual(local);
  });

  it('drops the server copy by school and date when no server id was stored', () => {
    const local = [{ id: 1, schoolId: SCHOOL, attendanceDate: '08-10-2026', totalPresent: 90 }];
    const server = [{ id: 'srv-1', school_id: SCHOOL, attendance_date: '08-10-2026', total_present: 95 }];

    expect(mergeLocalAndServerRecords(local, server, fields)).toEqual(local);
  });

  it('keeps server records the device does not have, after the local ones', () => {
    const local = [{ id: 1, schoolId: SCHOOL, attendanceDate: '08-10-2026' }];
    const server = [
      { id: 'srv-1', school_id: SCHOOL, attendance_date: '08-10-2026' },
      { id: 'srv-2', school_id: SCHOOL, attendance_date: '09-10-2026' },
    ];

    expect(mergeLocalAndServerRecords(local, server, fields).map((r) => r.id)).toEqual([1, 'srv-2']);
  });

  it('keeps records for the same date at a different school', () => {
    const local = [{ id: 1, schoolId: SCHOOL, attendanceDate: '08-10-2026' }];
    const server = [{ id: 'srv-9', school_id: 'other-school', attendance_date: '08-10-2026' }];

    expect(mergeLocalAndServerRecords(local, server, fields)).toHaveLength(2);
  });

  it('works with the meal distribution date fields', () => {
    const local = [{ id: 1, schoolId: SCHOOL, distributionDate: '08-10-2026' }];
    const server = [{ id: 'srv-1', school_id: SCHOOL, distribution_date: '08-10-2026' }];

    const merged = mergeLocalAndServerRecords(local, server, {
      localDateField: 'distributionDate',
      serverDateField: 'distribution_date',
    });

    expect(merged).toEqual(local);
  });
});
