/**
 * Which of a school's term figures need an officer's attention, and the sub-county
 * summary. The thresholds are plain rules an officer can check, stated on the page; they
 * mark figures to look at, not schools that did anything wrong.
 */

export const ATTENTION = {
  missingDays: 3,          // school days with no record at all
  rationLow: 0.9,          // food issued against the ration for learners fed
  rationHigh: 1.1,
  daysOfFood: 10,          // about two school weeks left in the store
  deliveryDays: 10,        // first delivery this many days after the term opened
  syncDays: 7,             // a week without the school's records reaching the server
};

/** The figures of one school that need attention, as { key: reason }. */
export function attention(school) {
  const notes = {};
  if (school.missing > ATTENTION.missingDays) notes.records = `${school.missing} school days with no record`;
  for (const [key, food] of [['cerealsVsRation', 'Cereals'], ['pulsesVsRation', 'Pulses']]) {
    const ratio = school[key];
    if (ratio !== null && ratio !== undefined && (ratio < ATTENTION.rationLow || ratio > ATTENTION.rationHigh)) {
      notes[key] = `${food} issued at ${ratio.toFixed(2)} times the ration`;
    }
  }
  if (school.daysOfFood !== null && school.daysOfFood < ATTENTION.daysOfFood) {
    notes.daysOfFood = `${school.daysOfFood} ${school.daysOfFood === 1 ? 'day' : 'days'} of food left`;
  }
  if (school.programmeType === 'in_kind') {
    if (school.firstDelivery === null) notes.delivery = 'No delivery this term';
    else if (school.deliveryDaysAfterOpening > ATTENTION.deliveryDays) notes.delivery = `First delivery ${school.deliveryDaysAfterOpening} days after opening`;
  }
  if (school.lastSync === null) notes.sync = 'Never synced';
  else if (school.daysSinceSync > ATTENTION.syncDays) notes.sync = `Records ${school.daysSinceSync} days behind`;
  return notes;
}

const mean = (values) => {
  const present = values.filter((v) => v !== null && v !== undefined);
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
};

/** Headline figures for the sub-county. */
export function summary(schools) {
  const schoolDays = schools.reduce((n, s) => n + s.schoolDays, 0);
  const recorded = schools.reduce((n, s) => n + s.recorded, 0);
  return {
    schools: schools.length,
    recordedShare: schoolDays ? recorded / schoolDays : null,
    meanCoverage: mean(schools.map((s) => s.coverage)),
    lowStock: schools.filter((s) => s.daysOfFood !== null && s.daysOfFood < ATTENTION.daysOfFood).length,
    notSynced: schools.filter((s) => s.lastSync === null || s.daysSinceSync > ATTENTION.syncDays).length,
    needAttention: schools.filter((s) => Object.keys(attention(s)).length > 0).length,
  };
}
