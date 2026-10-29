import { describe, expect, it, vi } from 'vitest';
import db from '../db/database';
import { getChanges } from '../services/api';
import { saveDailyFeeding } from '../services/feedingDb';
import { applyChanges, pullChanges } from './pullChanges';

vi.mock('../services/api', () => ({
  getChanges: vi.fn(),
}));

const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';

function download(overrides = {}) {
  return {
    cursor: '1200',
    school: { id: SCHOOL_ID, name: 'Demo Primary School', ration: { cereals: 150, pulses: 40, oil: 5, salt: 2 } },
    terms: [{ id: 't-3', year: 2026, term: 3, opensOn: '24-08-2026', closesOn: '23-10-2026' }],
    calendarEvents: [{ id: 'e-1', startsOn: '20-10-2026', endsOn: '20-10-2026', kind: 'public_holiday', name: 'Mashujaa Day' }],
    enrolment: [],
    dailyFeeding: [],
    stockMovements: [],
    stockCounts: [],
    ...overrides,
  };
}

const serverDay = {
  serverId: 'server-day-1', schoolId: SCHOOL_ID, feedingDate: '06-10-2026', feedingHappened: true,
  learnersFed: 400, cerealsKg: 60, pulsesKg: 16, version: 1,
};

describe('applyChanges', () => {
  it('stores the school settings, calendar and records, and the cursor', async () => {
    await applyChanges(SCHOOL_ID, download({
      dailyFeeding: [serverDay],
      stockMovements: [{ id: 'm-1', schoolId: SCHOOL_ID, movementDate: '05-10-2026', commodity: 'cereals', kind: 'delivery', quantityKg: 500 }],
    }));

    expect(await db.schoolSettings.get(SCHOOL_ID)).toMatchObject({ ration: { cereals: 150 } });
    expect(await db.terms.count()).toBe(1);
    expect(await db.calendarEvents.count()).toBe(1);
    expect(await db.dailyFeeding.toArray()).toEqual([expect.objectContaining({ ...serverDay, syncStatus: 'synced' })]);
    expect(await db.stockMovements.get('m-1')).toMatchObject({ quantityKg: 500, syncStatus: 'synced' });
    expect(await db.syncCursors.get(SCHOOL_ID)).toMatchObject({ cursor: '1200' });
  });

  it('updates a record to a newer server version', async () => {
    await applyChanges(SCHOOL_ID, download({ dailyFeeding: [serverDay] }));

    await applyChanges(SCHOOL_ID, download({ dailyFeeding: [{ ...serverDay, learnersFed: 395, version: 2 }] }));

    expect(await db.dailyFeeding.toArray()).toEqual([expect.objectContaining({ learnersFed: 395, version: 2 })]);
  });

  it('never replaces a local record with changes still to send', async () => {
    await saveDailyFeeding({ schoolId: SCHOOL_ID, feedingDate: '06-10-2026', feedingHappened: true, learnersFed: 410, cerealsKg: 61.5, pulsesKg: 16.4 });

    await applyChanges(SCHOOL_ID, download({ dailyFeeding: [serverDay] }));

    expect(await db.dailyFeeding.toArray()).toEqual([expect.objectContaining({ learnersFed: 410, syncStatus: 'pending' })]);
  });

  it('recognises a day this device recorded once it comes back from the server', async () => {
    const local = await saveDailyFeeding({ ...serverDay, serverId: undefined, version: undefined });
    await db.dailyFeeding.update(local.id, { syncStatus: 'synced', serverId: 'server-day-1' });

    await applyChanges(SCHOOL_ID, download({ dailyFeeding: [serverDay] }));

    expect(await db.dailyFeeding.count()).toBe(1);
  });
});

describe('pullChanges', () => {
  it('asks for everything the first time, then for changes since the last cursor', async () => {
    getChanges.mockResolvedValueOnce(download({ cursor: '1200', dailyFeeding: [serverDay] }));
    getChanges.mockResolvedValueOnce(download({ cursor: '1300' }));

    const first = await pullChanges(SCHOOL_ID);
    await pullChanges(SCHOOL_ID);

    expect(first).toBe(1);
    expect(getChanges.mock.calls.map(([args]) => args)).toEqual([
      { schoolId: SCHOOL_ID, since: '0' },
      { schoolId: SCHOOL_ID, since: '1200' },
    ]);
  });
});
