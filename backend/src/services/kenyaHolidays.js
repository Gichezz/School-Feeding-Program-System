/**
 * Kenya's public holidays for a year, worked out inside Lishe with no outside service, so
 * next year's calendar can be filled in ahead of time, offline, and keeps working if a
 * website or API goes away. An administrator reviews the result in the School calendar.
 *
 * - Fixed dates (Public Holidays Act, Cap. 110, as amended; Mazingira Day since 2024), the
 *   same list as forecasting/config/kenya_inputs.yaml. A fixed holiday on a Sunday is
 *   observed on the Monday (kenya_inputs.yaml, sunday_rule: next_monday).
 * - Good Friday and Easter Monday from the date of Easter (Western churches).
 * - Eid al-Fitr is set by the moon sighting and gazetted close to the day, so only an
 *   estimate is given (1 Shawwal in the Umm al-Qura calendar, on the Monday if that is a
 *   Sunday), marked to confirm until an administrator confirms or corrects it.
 *
 * Any date Lishe cannot be sure of is marked toConfirm. Eid al-Adha is not added: it is not
 * in the Act's schedule, and Kenya's 2024–2026 calendars (calendar_kenya.sql) have no such
 * holiday. An administrator adds any extra gazetted holiday by hand.
 */

const FIXED = [
  { month: 1, day: 1, name: "New Year's Day" },
  { month: 5, day: 1, name: 'Labour Day' },
  { month: 6, day: 1, name: 'Madaraka Day' },
  { month: 10, day: 10, name: 'Mazingira Day' },
  { month: 10, day: 20, name: 'Mashujaa Day' },
  { month: 12, day: 12, name: 'Jamhuri Day' },
  { month: 12, day: 25, name: 'Christmas Day' },
  { month: 12, day: 26, name: 'Boxing Day' },
];

const pad = (n) => String(n).padStart(2, '0');
const iso = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;
const utc = (isoDate) => new Date(`${isoDate}T00:00:00Z`);
const addDays = (isoDate, days) => {
  const d = utc(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const isSunday = (isoDate) => utc(isoDate).getUTCDay() === 0;

/**
 * Easter Sunday (Gregorian), YYYY-MM-DD: the anonymous Gregorian algorithm
 * (Meeus/Jones/Butcher).
 */
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

/**
 * 1 Shawwal in the Umm al-Qura calendar that falls in `year`, YYYY-MM-DD, or null when
 * this runtime has no Islamic calendar (Node ships one with its full ICU data).
 */
function firstOfShawwal(year) {
  let format;
  try {
    format = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
  } catch {
    return null;
  }
  for (let date = `${year}-01-01`; date.startsWith(String(year)); date = addDays(date, 1)) {
    if (format.format(utc(date)) === '10/1') return date;
  }
  return null;
}

/**
 * The year's public holidays, by date: [{ name, date: 'YYYY-MM-DD', toConfirm }].
 */
function kenyaHolidays(year) {
  const holidays = [];

  for (const { month, day, name } of FIXED) {
    let date = iso(year, month, day);
    let toConfirm = false;
    if (isSunday(date)) {
      date = addDays(date, 1);
      // Christmas on a Sunday moves onto Boxing Day; the day after is a guess to check
      if (FIXED.some((f) => iso(year, f.month, f.day) === date)) {
        date = addDays(date, 1);
        toConfirm = true;
      }
    }
    holidays.push({ name, date, toConfirm });
  }

  const easter = easterSunday(year);
  holidays.push({ name: 'Good Friday', date: addDays(easter, -2), toConfirm: false });
  holidays.push({ name: 'Easter Monday', date: addDays(easter, 1), toConfirm: false });

  let eid = firstOfShawwal(year);
  if (eid) {
    if (isSunday(eid)) eid = addDays(eid, 1);
    holidays.push({ name: 'Eid al-Fitr', date: eid, toConfirm: true });
  }

  return holidays.sort((x, y) => x.date.localeCompare(y.date) || x.name.localeCompare(y.name));
}

module.exports = { kenyaHolidays, easterSunday, firstOfShawwal, FIXED_HOLIDAYS: FIXED };
