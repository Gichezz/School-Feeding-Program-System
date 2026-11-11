import { toDate } from '../../utils/format';
import { checkEntryWindow, lateReasonError } from '../recording/entryWindow';
import { toCount } from '../recording/validation';

/**
 * Feeding and stock calculations for a school, worked out on the device from the records
 * it holds (its own and those downloaded from the school's other devices), so they work
 * offline. No forecasting model: headcounts are planned with a moving average, which on
 * real school data was as good as the models (see docs/anomaly-detection.md, section 1).
 *
 * Dates are DD-MM-YYYY strings, as everywhere in the app; kilograms are numbers.
 */

export const COMMODITIES = ['cereals', 'pulses', 'oil', 'salt'];
export const COMMODITY_LABELS = { cereals: 'Cereals', pulses: 'Pulses', oil: 'Vegetable oil', salt: 'Salt' };
// The School Meals Programme ration, grams per learner per day
export const DEFAULT_RATION = { cereals: 150, pulses: 40, oil: 5, salt: 2 };
// School days in the moving average of learners fed
export const AVERAGE_DAYS = 10;

export const NOT_FED_REASONS = {
  no_food: 'No food in the store',
  school_closed: 'School closed',
  cook_absent: 'Cook absent',
  no_water_or_fuel: 'No water or firewood',
  learners_sent_home: 'Learners sent home',
  other: 'Other (explain in the note)',
};
export const UNUSUAL_REASONS = {
  half_day: 'Half day',
  school_event: 'School event',
  exams: 'Exams',
  visitors_fed: 'Visitors fed too',
  other: 'Other (explain in the note)',
};

const round2 = (n) => Math.round(n * 100) / 100;

/** A term's name: a practice term's own label, otherwise "Term 3 2026". */
export function termName(t) {
  return t?.label || (t ? `Term ${t.term} ${t.year}` : '');
}

/** DD-MM-YYYY → YYYY-MM-DD, which sorts and compares as text. */
export function dayKey(display) {
  const [d, m, y] = display.split('-');
  return `${y}-${m}-${d}`;
}

function fromKey(key) {
  const [y, m, d] = key.split('-');
  return `${d}-${m}-${y}`;
}

function keyOfDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey(now = new Date()) {
  return keyOfDate(now);
}

/** Kilograms of each commodity a feeding day took from the store. */
export function issuedOn(day, ration = DEFAULT_RATION) {
  if (!day.feedingHappened) return { cereals: 0, pulses: 0, oil: 0, salt: 0 };
  return {
    cereals: Number(day.cerealsKg) || 0,
    pulses: Number(day.pulsesKg) || 0,
    // Oil and salt are not weighed each day: they follow the ration for learners fed
    oil: (day.learnersFed * ration.oil) / 1000,
    salt: (day.learnersFed * ration.salt) / 1000,
  };
}

const INFLOW = new Set(['delivery', 'purchase']);

/** Signed kilograms a ledger entry adds to the store (a reversal cancels its entry). */
function signedKg(entry, byId) {
  if (entry.kind === 'reversal') {
    const target = byId.get(entry.reversesId);
    return target ? -signedKg(target, byId) : 0;
  }
  return INFLOW.has(entry.kind) ? Number(entry.quantityKg) : -Number(entry.quantityKg);
}

/**
 * Stock of each commodity at the end of `upTo` (YYYY-MM-DD, inclusive; all time when
 * omitted): everything received, minus losses, returns and daily issues.
 * excludeDate leaves one feeding day out (the day being edited).
 */
export function stockBalances({ movements = [], feedingDays = [], ration = DEFAULT_RATION, upTo, excludeDate }) {
  const balances = { cereals: 0, pulses: 0, oil: 0, salt: 0 };
  const byId = new Map(movements.map((m) => [m.id, m]));
  for (const m of movements) {
    if (upTo && dayKey(m.movementDate) > upTo) continue;
    balances[m.commodity] += signedKg(m, byId);
  }
  for (const day of feedingDays) {
    if (upTo && dayKey(day.feedingDate) > upTo) continue;
    if (excludeDate && day.feedingDate === excludeDate) continue;
    const issued = issuedOn(day, ration);
    for (const c of COMMODITIES) balances[c] -= issued[c];
  }
  return Object.fromEntries(COMMODITIES.map((c) => [c, round2(balances[c])]));
}

function inRange(key, from, to) {
  return key >= from && key <= to;
}

/**
 * School days from `from` to `to` (YYYY-MM-DD, inclusive): weekdays inside a term,
 * outside half-term, that are not a public holiday or a school closure.
 */
export function schoolDays(terms, events, from, to) {
  const closed = events.filter((e) => e.kind === 'public_holiday' || e.kind === 'school_closure');
  const days = [];
  const day = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  for (; day <= end; day.setDate(day.getDate() + 1)) {
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    const key = keyOfDate(day);
    const term = terms.find((t) => inRange(key, dayKey(t.opensOn), dayKey(t.closesOn)));
    if (!term) continue;
    if (term.halfTermStart && inRange(key, dayKey(term.halfTermStart), dayKey(term.halfTermEnd))) continue;
    if (closed.some((e) => inRange(key, dayKey(e.startsOn), dayKey(e.endsOn)))) continue;
    days.push(key);
  }
  return days;
}

/** The term containing today, else the next one, else the most recent. */
export function currentTerm(terms, now = new Date()) {
  const today = todayKey(now);
  const sorted = [...terms].sort((a, b) => dayKey(a.opensOn).localeCompare(dayKey(b.opensOn)));
  return sorted.find((t) => inRange(today, dayKey(t.opensOn), dayKey(t.closesOn)))
    || sorted.find((t) => dayKey(t.opensOn) > today)
    || sorted[sorted.length - 1]
    || null;
}

/** Average learners fed over the last `n` feeding days up to `upTo`, or null with none. */
export function averageFed(feedingDays, { n = AVERAGE_DAYS, upTo } = {}) {
  const fed = feedingDays
    .filter((d) => d.feedingHappened && (!upTo || dayKey(d.feedingDate) <= upTo))
    .sort((a, b) => dayKey(b.feedingDate).localeCompare(dayKey(a.feedingDate)))
    .slice(0, n);
  if (fed.length === 0) return null;
  return fed.reduce((sum, d) => sum + d.learnersFed, 0) / fed.length;
}

/**
 * How long the store lasts at the recent average. For each commodity: kg used per
 * feeding day, whole school days the stock covers, and whether it runs out before the
 * term's remaining school days. `limiting` is the commodity that runs out first.
 */
export function foodRemaining({ balances, fedPerDay, ration = DEFAULT_RATION, remainingDays = [] }) {
  if (!fedPerDay) return null;
  const perCommodity = {};
  for (const c of COMMODITIES) {
    const kgPerDay = (fedPerDay * ration[c]) / 1000;
    const days = kgPerDay > 0 ? Math.max(0, Math.floor(balances[c] / kgPerDay)) : null;
    const runsOut = days !== null && days < remainingDays.length;
    perCommodity[c] = {
      kgPerDay: round2(kgPerDay),
      days,
      runsOut,
      // The last school day it covers, when it runs out within the term
      lastsUntil: runsOut && days > 0 ? fromKey(remainingDays[days - 1]) : null,
      shortKg: runsOut ? round2(kgPerDay * remainingDays.length - balances[c]) : 0,
    };
  }
  const limiting = COMMODITIES.filter((c) => perCommodity[c].days !== null)
    .reduce((a, b) => (a === null || perCommodity[b].days < perCommodity[a].days ? b : a), null);
  return { perCommodity, limiting, remainingDays: remainingDays.length };
}

/**
 * Food to request for a term: enrolled learners × school days × ration, minus the stock
 * carried over. Only verified enrolment counts; if none is verified yet the total is
 * shown but marked as unverified.
 */
export function termRequirement({ enrolment, schoolDayCount, ration = DEFAULT_RATION, carryOver }) {
  const verified = enrolment.filter((e) => e.verified);
  const counted = verified.length > 0 ? verified : enrolment;
  const learners = counted.reduce((sum, e) => sum + e.learners, 0);
  const perCommodity = Object.fromEntries(COMMODITIES.map((c) => {
    const needKg = round2((learners * schoolDayCount * ration[c]) / 1000);
    const carryKg = Math.max(0, carryOver[c] || 0);
    return [c, { needKg, carryKg: round2(carryKg), requestKg: round2(Math.max(0, needKg - carryKg)) }];
  }));
  return { learners, verified: verified.length > 0, allVerified: verified.length === enrolment.length && enrolment.length > 0, schoolDayCount, perCommodity };
}

function toKg(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || Math.round(n * 100) !== n * 100) return null;
  return n;
}

/**
 * Check the daily feeding form on the device. Returns { errors, warnings, values, late }.
 *
 *   errors    hard rules, the same the server applies: the record cannot be saved
 *             (a missing answer, fed more than the present count given, a future date)
 *   warnings  checks against what this device knows, which can be out of date: more fed
 *             than enrolled (enrolment may not be updated yet) and more issued than this
 *             device's stock balance (a delivery recorded on another device may not have
 *             arrived yet). The teacher can confirm and save; the server checks the
 *             record against its own full records and flags it for review if needed.
 *
 * form: strings from the inputs; feedingHappened is 'yes', 'no' or ''.
 * enrolled: learners enrolled this term, or null when no enrolment is recorded yet.
 * available: stock before this day's issue, by commodity.
 */
export function validateFeeding(form, { enrolled = null, available = null, now = new Date() } = {}) {
  const errors = {};
  const warnings = {};
  if (!toDate(form.date)) errors.date = 'Enter the date as DD-MM-YYYY';
  const entry = form.date && toDate(form.date) ? checkEntryWindow(form.date, now) : { future: false, late: false };
  if (entry.future) errors.date = 'The date cannot be in the future';
  if (entry.late) {
    const reasonError = lateReasonError(form.lateReason || '');
    if (reasonError) errors.lateReason = reasonError;
  }
  if (form.feedingHappened !== 'yes' && form.feedingHappened !== 'no') errors.feedingHappened = 'Say whether learners were fed today';

  const happened = form.feedingHappened === 'yes';
  const present = form.learnersPresent === '' ? null : toCount(form.learnersPresent);
  if (form.learnersPresent !== '' && present === null) errors.learnersPresent = 'Enter a whole number, or leave it empty';

  const values = {
    schoolId: form.schoolId,
    feedingDate: form.date,
    feedingHappened: happened,
    learnersPresent: present,
    learnersFed: 0,
    cerealsKg: 0,
    pulsesKg: 0,
    reasonCode: form.reasonCode || null,
    note: form.note?.trim() || null,
    ...(entry.late && { lateReason: form.lateReason.trim() }),
  };

  if (happened) {
    const fed = toCount(form.learnersFed);
    const cereals = toKg(form.cerealsKg);
    const pulses = toKg(form.pulsesKg);
    if (fed === null) errors.learnersFed = 'Enter the number of learners fed';
    if (cereals === null) errors.cerealsKg = 'Enter the kilograms of cereals issued, to at most 2 decimals';
    if (pulses === null) errors.pulsesKg = 'Enter the kilograms of pulses issued, to at most 2 decimals';
    if (fed !== null && present !== null && fed > present) errors.learnersFed = `Learners fed cannot be more than the ${present} present`;
    else if (fed !== null && enrolled !== null && fed > enrolled) warnings.learnersFed = `${fed} learners fed is more than the ${enrolled} enrolled this term`;
    if (available && cereals !== null && cereals > available.cereals) warnings.cerealsKg = `This device shows only ${available.cereals} kg of cereals in the store`;
    if (available && pulses !== null && pulses > available.pulses) warnings.pulsesKg = `This device shows only ${available.pulses} kg of pulses in the store`;
    if (values.reasonCode && !UNUSUAL_REASONS[values.reasonCode]) errors.reasonCode = 'Choose a reason for a day when learners were fed';
    Object.assign(values, { learnersFed: fed, cerealsKg: cereals, pulsesKg: pulses });
  } else if (form.feedingHappened === 'no') {
    if (!values.reasonCode || !NOT_FED_REASONS[values.reasonCode]) errors.reasonCode = 'Choose why learners were not fed';
  }
  if (values.reasonCode === 'other' && !values.note) errors.note = 'Describe the reason';
  return { errors, warnings, values, late: entry.late };
}

/**
 * The figures for a termly report, up to `asOf` (YYYY-MM-DD) or the end of the term.
 */
export function termReport({ term, terms, events, feedingDays, enrolment, movements, counts, ration = DEFAULT_RATION, now = new Date() }) {
  const opens = dayKey(term.opensOn);
  const closes = dayKey(term.closesOn);
  const today = todayKey(now);
  const upTo = today < closes ? today : closes;
  const expected = upTo >= opens ? schoolDays(terms, events, opens, upTo) : [];
  const days = feedingDays.filter((d) => inRange(dayKey(d.feedingDate), opens, upTo));
  const fedDays = days.filter((d) => d.feedingHappened);
  const recorded = new Set(days.map((d) => dayKey(d.feedingDate)));

  const notFed = {};
  for (const d of days.filter((x) => !x.feedingHappened)) notFed[d.reasonCode] = (notFed[d.reasonCode] || 0) + 1;

  const termEnrolment = enrolment.filter((e) => e.termId === term.id);
  const enrolled = termEnrolment.reduce((s, e) => s + e.learners, 0);
  const bySex = { F: 0, M: 0 };
  for (const e of termEnrolment) bySex[e.sex] += e.learners;

  const avgFed = fedDays.length ? fedDays.reduce((s, d) => s + d.learnersFed, 0) / fedDays.length : null;
  const consumption = Object.fromEntries(COMMODITIES.map((c) => {
    const issued = fedDays.reduce((s, d) => s + issuedOn(d, ration)[c], 0);
    const expectedKg = fedDays.reduce((s, d) => s + (d.learnersFed * ration[c]) / 1000, 0);
    return [c, { issuedKg: round2(issued), rationKg: round2(expectedKg), ratio: expectedKg > 0 ? issued / expectedKg : null }];
  }));

  const dayBefore = new Date(`${opens}T12:00:00`);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const opening = stockBalances({ movements, feedingDays, ration, upTo: keyOfDate(dayBefore) });
  const closing = stockBalances({ movements, feedingDays, ration, upTo });
  const received = Object.fromEntries(COMMODITIES.map((c) => [c, round2(movements
    .filter((m) => INFLOW.has(m.kind) && m.commodity === c && inRange(dayKey(m.movementDate), opens, upTo))
    .reduce((s, m) => s + Number(m.quantityKg), 0))]));
  const deliveries = movements
    .filter((m) => INFLOW.has(m.kind) && inRange(dayKey(m.movementDate), opens, upTo))
    .sort((a, b) => dayKey(a.movementDate).localeCompare(dayKey(b.movementDate)));

  // Latest physical count per commodity, against the ledger on that date
  const lastCount = {};
  for (const c of COMMODITIES) {
    const count = counts.filter((k) => k.commodity === c && dayKey(k.countDate) <= upTo)
      .sort((a, b) => dayKey(b.countDate).localeCompare(dayKey(a.countDate)))[0];
    if (count) {
      const ledger = stockBalances({ movements, feedingDays, ration, upTo: dayKey(count.countDate) })[c];
      lastCount[c] = { date: count.countDate, countedKg: Number(count.countedKg), ledgerKg: ledger, differenceKg: round2(Number(count.countedKg) - ledger) };
    }
  }

  return {
    term,
    upTo: fromKey(upTo),
    expectedDays: expected.length,
    fedDays: fedDays.length,
    notFedDays: days.length - fedDays.length,
    notRecordedDays: expected.filter((k) => !recorded.has(k)).length,
    notFed,
    enrolled,
    bySex,
    avgFed,
    coverage: avgFed !== null && enrolled > 0 ? avgFed / enrolled : null,
    consumption,
    opening,
    received,
    closing,
    deliveries,
    lastCount,
  };
}
