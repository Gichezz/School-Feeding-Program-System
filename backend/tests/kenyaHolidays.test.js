const fs = require('fs');
const path = require('path');
const { kenyaHolidays, easterSunday, firstOfShawwal } = require('../src/services/kenyaHolidays');

/** The public holidays calendar_kenya.sql loads for a year (from the gazette), by name. */
function gazetted(year) {
  const sql = fs.readFileSync(path.join(__dirname, '../../database/calendar_kenya.sql'), 'utf8');
  const rows = [...sql.matchAll(/\(DATE '(\d{4}-\d{2}-\d{2})', DATE '\d{4}-\d{2}-\d{2}', 'public_holiday', '((?:[^']|'')+)'\)/g)];
  return Object.fromEntries(rows.filter(([, date]) => date.startsWith(String(year))).map(([, date, name]) => [name.replace("''", "'"), date]));
}

describe('easterSunday', () => {
  it.each([
    [2000, '2000-04-23'], [2008, '2008-03-23'], [2011, '2011-04-24'], [2019, '2019-04-21'],
    [2024, '2024-03-31'], [2025, '2025-04-20'], [2026, '2026-04-05'], [2027, '2027-03-28'],
    [2038, '2038-04-25'], [2285, '2285-03-22'],
  ])('%i: %s', (year, date) => {
    expect(easterSunday(year)).toBe(date);
  });
});

describe('kenyaHolidays', () => {
  it.each([2024, 2025, 2026])('gives the gazetted holidays for %i', (year) => {
    const worked = Object.fromEntries(kenyaHolidays(year).map((h) => [h.name, h.date]));

    expect(worked).toEqual(gazetted(year));
  });

  it('moves a fixed holiday on a Sunday to the Monday', () => {
    const byName = Object.fromEntries(kenyaHolidays(2027).map((h) => [h.name, h]));

    expect(byName['Mazingira Day'].date).toBe('2027-10-11');
    expect(byName['Jamhuri Day'].date).toBe('2027-12-13');
    expect(byName['Boxing Day'].date).toBe('2027-12-27');
    expect(byName['Christmas Day'].date).toBe('2027-12-25');
  });

  it('marks Christmas on a Sunday, moved past Boxing Day, to confirm', () => {
    // 25 December 2033 is a Sunday
    const christmas = kenyaHolidays(2033).find((h) => h.name === 'Christmas Day');
    const boxing = kenyaHolidays(2033).find((h) => h.name === 'Boxing Day');

    expect(christmas).toEqual({ name: 'Christmas Day', date: '2033-12-27', toConfirm: true });
    expect(boxing).toEqual({ name: 'Boxing Day', date: '2033-12-26', toConfirm: false });
  });

  it('gives Good Friday and Easter Monday around Easter', () => {
    const byName = Object.fromEntries(kenyaHolidays(2027).map((h) => [h.name, h]));

    expect(byName['Good Friday']).toEqual({ name: 'Good Friday', date: '2027-03-26', toConfirm: false });
    expect(byName['Easter Monday']).toEqual({ name: 'Easter Monday', date: '2027-03-29', toConfirm: false });
  });

  it('estimates Eid al-Fitr and marks it to confirm', () => {
    const eid = kenyaHolidays(2027).find((h) => h.name === 'Eid al-Fitr');

    expect(firstOfShawwal(2027)).toBe('2027-03-09');
    expect(eid).toEqual({ name: 'Eid al-Fitr', date: '2027-03-09', toConfirm: true });
  });

  it('has eleven holidays, in date order, and no Eid al-Adha', () => {
    const list = kenyaHolidays(2028);

    expect(list).toHaveLength(11);
    expect(list.map((h) => h.date)).toEqual([...list.map((h) => h.date)].sort());
    expect(list.map((h) => h.name)).not.toContain('Eid al-Adha');
  });
});
