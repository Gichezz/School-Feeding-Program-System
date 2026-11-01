import { describe, expect, it } from 'vitest';
import { attention, summary } from './analyticsData';

const steady = {
  schoolDays: 34, recorded: 34, missing: 0, coverage: 0.9, cerealsVsRation: 1.02, pulsesVsRation: 0.97,
  daysOfFood: 25, programmeType: 'in_kind', firstDelivery: '26-08-2026', deliveryDaysAfterOpening: 2,
  lastSync: '2026-10-07T12:00:00Z', daysSinceSync: 1,
};

describe('attention', () => {
  it('finds nothing in a school whose figures are as expected', () => {
    expect(attention(steady)).toEqual({});
  });

  it('names each figure outside its rule', () => {
    const notes = attention({
      ...steady, missing: 5, cerealsVsRation: 1.25, daysOfFood: 6, deliveryDaysAfterOpening: 21, daysSinceSync: 12,
    });

    expect(notes).toEqual({
      records: '5 school days with no record',
      cerealsVsRation: 'Cereals issued at 1.25 times the ration',
      daysOfFood: '6 days of food left',
      delivery: 'First delivery 21 days after opening',
      sync: 'Records 12 days behind',
    });
  });

  it('does not expect deliveries at schools that buy their own food', () => {
    expect(attention({ ...steady, programmeType: 'cash_transfer', firstDelivery: null })).toEqual({});
  });
});

describe('summary', () => {
  it('adds up the sub-county', () => {
    const result = summary([steady, { ...steady, recorded: 17, missing: 17, coverage: 0.7, lastSync: null, daysSinceSync: null }]);

    expect(result).toEqual({ schools: 2, recordedShare: 51 / 68, meanCoverage: 0.8, lowStock: 0, notSynced: 1, needAttention: 1 });
  });
});
