import { COMMODITY_LABELS } from './planning';

// Food is recorded to the nearest half kilogram, so anything closer to zero than a
// quarter of a kilogram is shown as zero (never "-0 kg")
const ZERO_KG = 0.25;

/**
 * How a ledger balance is shown. A store cannot hold less than nothing: a balance
 * below zero means more food was recorded as used than as received (a delivery not
 * recorded yet, or recorded on a device that has not synced). The shown figure is
 * then 0 kg and the gap is reported as a shortfall, in words. The ledger value itself
 * is unchanged and still used for planning and stock counts.
 *
 * @param {number} kg - the ledger balance
 * @returns {{ shownKg: number, shortfallKg: number }}
 */
export function displayBalance(kg) {
  const value = Number(kg) || 0;
  if (value < -ZERO_KG) return { shownKg: 0, shortfallKg: Math.round(-value * 2) / 2 };
  if (value < ZERO_KG) return { shownKg: 0, shortfallKg: 0 };
  return { shownKg: Math.round(value * 100) / 100, shortfallKg: 0 };
}

/**
 * The one line at the top of Today that says whether the food will last the term.
 *
 * kind:
 *   'incomplete' – a balance is below zero, so days of food cannot be known;
 *                  short: [{ commodity, shortfallKg }] for each one
 *   'runsOut'    – food runs out before the term ends (tell the head teacher)
 *   'enough'     – food lasts the rest of the term
 *   'unknown'    – no feeding recorded yet to plan from
 *   'noTerm'     – no school days left in the term
 *
 * @param {{ balances, food, remainingDays: number }} input - food is foodRemaining()'s result
 */
export function foodStatus({ balances, food, remainingDays }) {
  const short = Object.entries(balances)
    .filter(([commodity]) => commodity in COMMODITY_LABELS)
    .map(([commodity, kg]) => ({ commodity, ...displayBalance(kg) }))
    .filter((b) => b.shortfallKg > 0);
  if (short.length > 0) {
    return { kind: 'incomplete', short: short.map(({ commodity, shortfallKg }) => ({ commodity, shortfallKg })) };
  }
  if (remainingDays === 0) return { kind: 'noTerm' };
  if (!food || !food.limiting) return { kind: 'unknown', remainingDays };
  const limiting = food.perCommodity[food.limiting];
  return {
    kind: limiting.runsOut ? 'runsOut' : 'enough',
    commodity: food.limiting,
    days: limiting.days,
    remainingDays,
  };
}
