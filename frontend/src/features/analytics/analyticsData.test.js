import { describe, expect, it } from 'vitest';
import { attention, summary, triage } from './analyticsData';

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

describe('attention: stock records', () => {
  it('says the stock records are incomplete, not low, when more was used than received', () => {
    expect(attention({ ...steady, cerealsInStoreKg: -30, daysOfFood: 0 })).toEqual({ stock: 'Stock records incomplete' });
  });

  it('counts a store at zero as low on food', () => {
    expect(attention({ ...steady, cerealsInStoreKg: 0, daysOfFood: 0 })).toEqual({ daysOfFood: '0 days of food left' });
  });
});

describe('triage', () => {
  const withNotes = (school) => ({ ...school, notes: attention(school) });

  it('puts schools whose figures cannot be trusted first, and only there', () => {
    const behind = withNotes({ ...steady, name: 'Behind', daysSinceSync: 12, daysOfFood: 2 });
    const incomplete = withNotes({ ...steady, name: 'Incomplete', cerealsInStoreKg: -5, daysOfFood: 0 });
    const low = withNotes({ ...steady, name: 'Low', daysOfFood: 3, deliveryDaysAfterOpening: 20 });
    const groups = triage([behind, incomplete, low, withNotes(steady)]);

    expect(groups.cantJudge.map((s) => s.name)).toEqual(['Behind', 'Incomplete']);
    expect(groups.daysOfFood.map((s) => s.name)).toEqual(['Low']);
    expect(groups.delivery.map((s) => s.name)).toEqual(['Low']);
    expect(groups.records).toEqual([]);
    expect(groups.ration).toEqual([]);
  });
});

describe('summary', () => {
  it('adds up the sub-county', () => {
    const result = summary([steady, { ...steady, recorded: 17, missing: 17, coverage: 0.7, lastSync: null, daysSinceSync: null }]);

    expect(result).toEqual({ schools: 2, recordedShare: 51 / 68, meanCoverage: 0.8, lowStock: 0, notSynced: 1, needAttention: 1 });
  });
});
