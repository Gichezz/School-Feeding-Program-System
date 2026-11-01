import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import db from '../../db/database';
import { getDeviceIdentity } from '../devices/deviceIdentity';
import { DEFAULT_RATION, currentTerm } from './planning';

/**
 * Everything the school screens need, read live from this device, so they work offline
 * and update as soon as a download brings another device's records:
 *
 *   status    'loading' | 'no-school' (not a school device) | 'no-calendar' (never
 *             downloaded) | 'ready'
 *   schoolId, school (settings and ration), ration, terms, events, term (current),
 *   enrolment, feedingDays, movements, counts
 *   heldDeliveries  entries the server held as a possible second entry of a delivery note;
 *             left out of movements (and so of every balance) until someone decides
 */
export function useSchoolData() {
  const [schoolId, setSchoolId] = useState(undefined);
  const [data, setData] = useState(null);

  useEffect(() => {
    getDeviceIdentity().then((identity) => setSchoolId(identity?.schoolId || null)).catch(() => setSchoolId(null));
  }, []);

  useEffect(() => {
    if (!schoolId) return undefined;
    const subscription = liveQuery(async () => {
      const [school, terms, events, enrolment, feedingDays, movements, counts] = await Promise.all([
        db.schoolSettings.get(schoolId),
        db.terms.toArray(),
        db.calendarEvents.toArray(),
        db.enrolment.filter((e) => e.schoolId === schoolId).toArray(),
        db.dailyFeeding.filter((d) => d.schoolId === schoolId).toArray(),
        db.stockMovements.where('schoolId').equals(schoolId).toArray(),
        db.stockCounts.where('schoolId').equals(schoolId).toArray(),
      ]);
      const heldDeliveries = movements.filter((m) => m.heldReason === 'duplicate_delivery' && m.syncStatus === 'held');
      return {
        school, terms, events, enrolment, feedingDays, counts, heldDeliveries,
        movements: movements.filter((m) => !heldDeliveries.includes(m)),
      };
    }).subscribe({ next: setData, error: () => setData(null) });
    return () => subscription.unsubscribe();
  }, [schoolId]);

  if (schoolId === undefined || (schoolId && !data)) return { status: 'loading' };
  if (!schoolId) return { status: 'no-school' };
  if (data.terms.length === 0) return { status: 'no-calendar', schoolId, ...data };
  return {
    status: 'ready',
    schoolId,
    ...data,
    ration: data.school?.ration || DEFAULT_RATION,
    term: currentTerm(data.terms),
  };
}
