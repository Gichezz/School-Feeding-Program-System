import { describe, expect, it } from 'vitest';
import {
  averageFed, currentTerm, foodRemaining, schoolDays, stockBalances, termReport, termRequirement, validateFeeding,
  termName,
} from './planning';

const SCHOOL = '11111111-1111-1111-1111-111111111111';
// 2026 Term 3: 24 August – 23 October, no half-term; Mazingira Day 10 October is a Saturday,
// Mashujaa Day 20 October a Tuesday
const TERM3 = { id: 't3', year: 2026, term: 3, opensOn: '24-08-2026', closesOn: '23-10-2026', halfTermStart: null, halfTermEnd: null };
const TERM2 = { id: 't2', year: 2026, term: 2, opensOn: '27-04-2026', closesOn: '31-07-2026', halfTermStart: '24-06-2026', halfTermEnd: '28-06-2026' };
const EVENTS = [
  { id: 'h1', kind: 'public_holiday', name: 'Mashujaa Day', startsOn: '20-10-2026', endsOn: '20-10-2026' },
  { id: 'x1', kind: 'national_exam', name: 'KPSEA', startsOn: '26-10-2026', endsOn: '30-10-2026' },
];

const delivery = (id, commodity, kg, date = '24-08-2026') => ({ id, schoolId: SCHOOL, movementDate: date, commodity, kind: 'delivery', quantityKg: kg, reference: `DN-${id}` });
const fedDay = (date, fed, cerealsKg = (fed * 150) / 1000, pulsesKg = (fed * 40) / 1000) => ({
  schoolId: SCHOOL, feedingDate: date, feedingHappened: true, learnersFed: fed, cerealsKg, pulsesKg,
});

describe('stockBalances', () => {
  it('adds deliveries, takes away issues and derives oil and salt from the ration', () => {
    const balances = stockBalances({
      movements: [delivery('a', 'cereals', 500), delivery('b', 'pulses', 120), delivery('c', 'oil', 20), delivery('d', 'salt', 10)],
      feedingDays: [fedDay('25-08-2026', 400), fedDay('26-08-2026', 380)],
    });

    // cereals 500 − 60 − 57; oil 20 − 0.78 × 5 kg per 1000 learners
    expect(balances).toEqual({ cereals: 383, pulses: 88.8, oil: 16.1, salt: 8.44 });
  });

  it('cancels a delivery with its reversal, and counts losses out', () => {
    const balances = stockBalances({
      movements: [
        delivery('a', 'cereals', 500),
        { id: 'r', movementDate: '25-08-2026', commodity: 'cereals', kind: 'reversal', quantityKg: 500, reversesId: 'a' },
        delivery('b', 'cereals', 450, '26-08-2026'),
        { id: 'l', movementDate: '27-08-2026', commodity: 'cereals', kind: 'loss', quantityKg: 12.5, note: 'Weevils' },
      ],
    });

    expect(balances.cereals).toBe(437.5);
  });

  it('counts only up to a date, and can leave out the day being edited', () => {
    const feedingDays = [fedDay('25-08-2026', 400), fedDay('26-08-2026', 400)];
    const movements = [delivery('a', 'cereals', 500)];

    expect(stockBalances({ movements, feedingDays, upTo: '2026-08-25' }).cereals).toBe(440);
    expect(stockBalances({ movements, feedingDays, excludeDate: '26-08-2026' }).cereals).toBe(440);
  });
});

describe('schoolDays', () => {
  it('counts weekdays in term, skipping half-term and public holidays', () => {
    expect(schoolDays([TERM3], EVENTS, '2026-10-19', '2026-10-23')).toEqual(['2026-10-19', '2026-10-21', '2026-10-22', '2026-10-23']);
    // Half-term 24–28 June: Wednesday to Sunday
    expect(schoolDays([TERM2], [], '2026-06-22', '2026-06-30')).toEqual(['2026-06-22', '2026-06-23', '2026-06-29', '2026-06-30']);
  });

  it('gives the real length of a term, not an assumed figure', () => {
    expect(schoolDays([TERM3], EVENTS, '2026-08-24', '2026-10-23')).toHaveLength(44);
  });
});

describe('currentTerm', () => {
  it('finds the term containing today, else the next one', () => {
    expect(currentTerm([TERM2, TERM3], new Date(2026, 8, 15)).id).toBe('t3');
    expect(currentTerm([TERM2, TERM3], new Date(2026, 7, 10)).id).toBe('t3');
  });
});

describe('averageFed', () => {
  it('averages the most recent feeding days only', () => {
    const days = [fedDay('24-08-2026', 300), ...Array.from({ length: 10 }, (_, i) => fedDay(`${String(i + 1).padStart(2, '0')}-09-2026`, 400))];

    expect(averageFed(days)).toBe(400);
  });
});

describe('foodRemaining', () => {
  it('says which commodity runs out first and on which school day', () => {
    const remaining = schoolDays([TERM3], EVENTS, '2026-10-12', '2026-10-23');
    const result = foodRemaining({ balances: { cereals: 300, pulses: 200, oil: 50, salt: 20 }, fedPerDay: 400, remainingDays: remaining });

    expect(result.limiting).toBe('cereals');
    expect(result.perCommodity.cereals).toEqual({ kgPerDay: 60, days: 5, runsOut: true, lastsUntil: '16-10-2026', shortKg: 240 });
    expect(result.perCommodity.pulses.runsOut).toBe(false);
  });
});

describe('termRequirement', () => {
  it('needs verified enrolment × school days × ration, less the carry-over', () => {
    const enrolment = [{ learners: 200, verified: true }, { learners: 210, verified: true }];

    const result = termRequirement({ enrolment, schoolDayCount: 43, carryOver: { cereals: 300, pulses: 0, oil: 5, salt: 50 } });

    expect(result).toMatchObject({ learners: 410, verified: true, allVerified: true });
    expect(result.perCommodity.cereals).toEqual({ needKg: 2644.5, carryKg: 300, requestKg: 2344.5 });
    expect(result.perCommodity.salt.requestKg).toBe(0);
  });

  it('marks the requirement unverified when no enrolment has been verified', () => {
    expect(termRequirement({ enrolment: [{ learners: 100, verified: false }], schoolDayCount: 10, carryOver: {} }).verified).toBe(false);
  });

  it('counts a class changed since it was checked at its last verified number', () => {
    const enrolment = [
      { learners: 200, verified: true, verifiedLearners: 200 },
      // Raised from 210 to 260 on the device; the officer has not checked it yet
      { learners: 260, verified: false, verifiedLearners: 210 },
    ];

    const result = termRequirement({ enrolment, schoolDayCount: 10, carryOver: {} });

    expect(result).toMatchObject({ learners: 410, verified: true, allVerified: false, awaitingCheck: 1 });
  });
});

describe('validateFeeding', () => {
  const now = new Date(2026, 9, 8, 9);
  const form = { schoolId: SCHOOL, date: '08-10-2026', feedingHappened: 'yes', learnersPresent: '410', learnersFed: '400', cerealsKg: '60', pulsesKg: '16', reasonCode: '', note: '', lateReason: '' };

  it('accepts a normal day', () => {
    const { errors, values } = validateFeeding(form, { enrolled: 420, available: { cereals: 500, pulses: 100 }, now });

    expect(errors).toEqual({});
    expect(values).toMatchObject({ feedingHappened: true, learnersFed: 400, cerealsKg: 60, reasonCode: null });
  });

  it('warns, without refusing, about more fed than enrolled and more issued than this device shows in store', () => {
    const { errors, warnings } = validateFeeding({ ...form, learnersPresent: '' }, { enrolled: 350, available: { cereals: 40, pulses: 100 }, now });

    // Enrolment and this device's stock balance can be out of date, so these can be confirmed
    expect(errors).toEqual({});
    expect(warnings.learnersFed).toMatch(/350 enrolled/);
    expect(warnings.cerealsKg).toMatch(/only 40 kg/);
  });

  it('still refuses more fed than the present count given', () => {
    const { errors, warnings } = validateFeeding({ ...form, learnersPresent: '390' }, { enrolled: 350, now });

    expect(errors.learnersFed).toMatch(/390 present/);
    expect(warnings.learnersFed).toBeUndefined();
  });

  it('asks for a reason when learners were not fed, and records nothing issued', () => {
    const notFed = { ...form, feedingHappened: 'no' };

    expect(validateFeeding(notFed, { now }).errors.reasonCode).toMatch(/why/);
    const { errors, values } = validateFeeding({ ...notFed, reasonCode: 'no_food' }, { now });
    expect(errors).toEqual({});
    expect(values).toMatchObject({ feedingHappened: false, learnersFed: 0, cerealsKg: 0, pulsesKg: 0, reasonCode: 'no_food' });
  });

  it('asks for a late-entry reason for an older date', () => {
    expect(validateFeeding({ ...form, date: '29-09-2026' }, { now }).errors.lateReason).toBeTruthy();
  });
});

describe('termReport', () => {
  it('compares feeding days with the calendar and food issued with the ration', () => {
    const feedingDays = [
      fedDay('19-10-2026', 400),
      fedDay('21-10-2026', 400, 72, 16), // 20% over the cereal ration
      { schoolId: SCHOOL, feedingDate: '22-10-2026', feedingHappened: false, learnersFed: 0, cerealsKg: 0, pulsesKg: 0, reasonCode: 'no_food' },
    ];
    const report = termReport({
      term: TERM3, terms: [TERM3], events: EVENTS, feedingDays,
      enrolment: [{ termId: 't3', sex: 'F', learners: 210 }, { termId: 't3', sex: 'M', learners: 200 }],
      movements: [delivery('a', 'cereals', 500, '19-10-2026')],
      counts: [{ commodity: 'cereals', countDate: '21-10-2026', countedKg: 360 }],
      now: new Date(2026, 10, 1),
    });

    expect(report).toMatchObject({ expectedDays: 44, fedDays: 2, notFedDays: 1, notFed: { no_food: 1 }, enrolled: 410, bySex: { F: 210, M: 200 }, avgFed: 400 });
    expect(report.notRecordedDays).toBe(41);
    expect(report.consumption.cereals).toEqual({ issuedKg: 132, rationKg: 120, ratio: 1.1 });
    // Ledger on 21 October: 500 − 60 − 72 = 368; counted 360
    expect(report.lastCount.cereals).toEqual({ date: '21-10-2026', countedKg: 360, ledgerKg: 368, differenceKg: -8 });
  });
});

describe('termName', () => {
  it("uses a practice term's label, and names real terms by number and year", () => {
    expect(termName({ term: null, year: 2026, label: 'Practice term (demonstration)' })).toBe('Practice term (demonstration)');
    expect(termName({ term: 3, year: 2026 })).toBe('Term 3 2026');
  });
});

describe('a practice term', () => {
  const practice = { id: 'p', year: 2026, term: null, label: 'Practice term (demonstration)', practice: true, opensOn: '26-10-2026', closesOn: '18-12-2026' };

  it('makes its weekdays school days, so recording on them is ordinary', () => {
    expect(schoolDays([practice], [], '2026-11-10', '2026-11-10')).toHaveLength(1);
    expect(schoolDays([practice], [], '2026-11-14', '2026-11-15')).toHaveLength(0);
  });

  it('is the current term while it runs', () => {
    expect(currentTerm([practice], new Date(2026, 10, 10))).toBe(practice);
  });
});
