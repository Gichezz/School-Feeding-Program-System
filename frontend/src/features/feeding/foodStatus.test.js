import { describe, expect, it } from 'vitest';
import { displayBalance, foodStatus } from './foodStatus';

describe('displayBalance', () => {
  it('shows a negative balance as 0 kg with the gap as a shortfall', () => {
    expect(displayBalance(-30)).toEqual({ shownKg: 0, shortfallKg: 30 });
    expect(displayBalance(-12.3)).toEqual({ shownKg: 0, shortfallKg: 12.5 });
  });

  it('never shows "-0": tiny balances either side of zero are 0 with no shortfall', () => {
    expect(displayBalance(-0.2)).toEqual({ shownKg: 0, shortfallKg: 0 });
    expect(displayBalance(0.1)).toEqual({ shownKg: 0, shortfallKg: 0 });
    expect(Object.is(displayBalance(-0.2).shownKg, -0)).toBe(false);
  });

  it('keeps a normal balance as it is', () => {
    expect(displayBalance(182.5)).toEqual({ shownKg: 182.5, shortfallKg: 0 });
  });
});

const food = (days, runsOut) => ({ limiting: 'cereals', perCommodity: { cereals: { days, runsOut } } });

describe('foodStatus', () => {
  it('says the stock records are incomplete when a balance is below zero', () => {
    expect(foodStatus({ balances: { cereals: -30, pulses: 10, oil: -10, salt: -0.1 }, food: food(0, true), remainingDays: 20 }))
      .toEqual({ kind: 'incomplete', short: [{ commodity: 'cereals', shortfallKg: 30 }, { commodity: 'oil', shortfallKg: 10 }] });
  });

  it('warns when food runs out before the term ends', () => {
    expect(foodStatus({ balances: { cereals: 60, pulses: 20 }, food: food(6, true), remainingDays: 34 }))
      .toEqual({ kind: 'runsOut', commodity: 'cereals', days: 6, remainingDays: 34 });
  });

  it('is calm when food lasts the term', () => {
    expect(foodStatus({ balances: { cereals: 900, pulses: 300 }, food: food(40, false), remainingDays: 34 }).kind).toBe('enough');
  });

  it('cannot plan without feeding records', () => {
    expect(foodStatus({ balances: { cereals: 100, pulses: 20 }, food: null, remainingDays: 34 }).kind).toBe('unknown');
  });

  it('has nothing to plan for when the term has no school days left', () => {
    expect(foodStatus({ balances: { cereals: 100, pulses: 20 }, food: food(10, false), remainingDays: 0 }).kind).toBe('noTerm');
  });
});
