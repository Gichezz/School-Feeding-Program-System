import { NOT_FED_REASONS } from './planning';
import { formatNumber } from '../../utils/format';

/**
 * The term's weekdays as feeding-register rows, Monday to Friday, with empty cells where
 * a term starts or ends mid-week.
 *
 * @param {{ weekday: number }[]} days - weekdays in order, weekday 1 (Mon) to 5 (Fri)
 * @returns {(object|null)[][]} one array of five cells per week
 */
export function registerWeeks(days) {
  const weeks = [];
  let week = null;
  days.forEach((day) => {
    if (!week || day.weekday <= week.lastWeekday) {
      week = { cells: Array(5).fill(null), lastWeekday: 0 };
      weeks.push(week);
    }
    week.cells[day.weekday - 1] = day;
    week.lastWeekday = day.weekday;
  });
  return weeks.map((w) => w.cells);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The register's month labels: the first day shown and the first day of each new month
 * get the short month name, so a run like 30, 1, 2 reads as the turn of a month.
 *
 * @param {{ date: string }[]} days - in order, dates as DD-MM-YYYY
 * @returns {Map<string, string>} date -> short month name
 */
export function monthLabels(days) {
  const labels = new Map();
  let month = null;
  days.forEach((day) => {
    const m = Number(day.date.slice(3, 5));
    if (m !== month) labels.set(day.date, MONTHS[m - 1]);
    month = m;
  });
  return labels;
}

/**
 * One plain sentence on the term so far, and a second when the school has stopped
 * feeding (three or more school days in a row without it, since the last fed day).
 */
export function termSentence(summary, days) {
  const counted = days.filter((d) => ['fed', 'not_fed', 'not_recorded'].includes(d.kind));
  let trailing = 0;
  for (let i = counted.length - 1; i >= 0 && counted[i].kind !== 'fed'; i -= 1) trailing += 1;
  const tally = {};
  counted.slice(counted.length - trailing).forEach((d) => { if (d.reason) tally[d.reason] = (tally[d.reason] || 0) + 1; });
  const common = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
  return {
    text: `${formatNumber(summary.fed)} of ${formatNumber(summary.schoolDays)} school days fed${summary.upcoming > 0 ? ' so far' : ''} this term.`,
    stopped: trailing >= 3 && summary.lastFed
      ? `No feeding since ${summary.lastFed}: the last ${formatNumber(trailing)} school days${common ? `, with “${NOT_FED_REASONS[common] || common}” given as the reason` : ''}.`
      : null,
    notRecorded: summary.notRecorded,
  };
}
