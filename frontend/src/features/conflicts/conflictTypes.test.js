import { describe, expect, it } from 'vitest';
import { compareRows, conflictType, mergeStart, mergeValues, showValue } from './conflictTypes';

const local = {
  schoolId: 's1', feedingDate: '06-10-2026', feedingHappened: true, learnersPresent: 410, learnersFed: 400,
  cerealsKg: 60, pulsesKg: 16, reasonCode: 'visitors_fed', note: null,
};
const server = {
  feeding_happened: true, learners_present: 410, learners_fed: 380, cereals_kg: '57.00', pulses_kg: '16.00',
  reason_code: null, note: null,
};

describe('conflictType', () => {
  it('knows both the server and the device names of a record type', () => {
    expect(conflictType('daily_feeding')).toBe(conflictType('dailyFeeding'));
    expect(conflictType('stock_movement')).toBeNull();
  });
});

describe('compareRows', () => {
  it('marks only the fields that differ, reading numbers the database returns as text', () => {
    const rows = compareRows(conflictType('daily_feeding'), local, server);
    const differs = rows.filter((r) => r.differs).map((r) => r.name);

    expect(differs).toEqual(['learnersFed', 'cerealsKg', 'reasonCode']);
  });
});

describe('merging', () => {
  const type = conflictType('daily_feeding');

  it("starts from the server's numbers", () => {
    expect(mergeStart(type, local, server)).toEqual({ learnersPresent: '410', learnersFed: '380', cerealsKg: '57', pulsesKg: '16' });
  });

  it("sends every field, the rest from the device's version", () => {
    const { values, errors } = mergeValues(type, local, { learnersPresent: '410', learnersFed: '395', cerealsKg: '59.5', pulsesKg: '16' });

    expect(errors).toEqual({});
    expect(values).toEqual({ ...local, learnersFed: 395, cerealsKg: 59.5, schoolId: undefined, feedingDate: undefined });
  });

  it('refuses impossible numbers', () => {
    const { errors } = mergeValues(type, local, { learnersPresent: '300', learnersFed: '320', cerealsKg: '-1', pulsesKg: '2.5' });

    expect(errors).toEqual({ learnersFed: 'Cannot be more than learners present', cerealsKg: 'Enter kilograms (0 or more)' });
  });

  it('is only offered for feeding records when both versions say learners were fed', () => {
    expect(type.canMerge(local, server)).toBe(true);
    expect(type.canMerge(local, { ...server, feeding_happened: false })).toBe(false);
  });
});

describe('showValue', () => {
  it('shows reasons and yes/no in words', () => {
    const [happened] = conflictType('daily_feeding').fields;
    const reason = conflictType('daily_feeding').fields.find((f) => f.kind === 'reason');

    expect(showValue(happened, false)).toBe('No');
    expect(showValue(reason, 'no_food')).toMatch(/food/i);
  });
});
