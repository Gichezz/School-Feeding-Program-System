/**
 * Weeks for the weekly review list. A week is named by its Monday, DD-MM-YYYY, as the
 * API expects.
 */

const pad = (n) => String(n).padStart(2, '0');
const display = (date) => `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;

/** The Monday of the week `now` falls in, and the `count - 1` weeks before it, newest first. */
export function recentMondays(now = new Date(), count = 8) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() - 7 * i);
    return display(d);
  });
}

const toTime = (week) => {
  const [d, m, y] = week.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

/**
 * The weeks an officer can pick, newest first: at least the last `count` weeks, back to
 * `firstWeek` (the first week of the latest term to have opened, from the API) so the whole
 * term stays reachable in the holidays, and any older week already scored.
 */
export function reviewWeeks(now = new Date(), firstWeek = null, scored = [], count = 8) {
  const MAX_WEEKS = 60;
  let weeks = recentMondays(now, MAX_WEEKS);
  const stop = firstWeek ? weeks.indexOf(firstWeek) : -1;
  weeks = weeks.slice(0, Math.max(count, stop + 1));
  const all = new Set([...weeks, ...scored]);
  return [...all].sort((a, b) => toTime(b) - toTime(a));
}

/** "Week of 05-10-2026 (this week)", with how far the officer has got through its list. */
export function weekLabel(week, scored, index) {
  const when = index === 0 ? ' (this week)' : index === 1 ? ' (last week)' : '';
  if (!scored) return `Week of ${week}${when} · not scored`;
  const progress = scored.listed === 0 ? 'nothing listed' : `${scored.decided} of ${scored.listed} reviewed`;
  return `Week of ${week}${when} · ${progress}`;
}

/**
 * What to say about a week with no list yet. The page opens on last week, so it names the
 * week it means rather than calling every week "this week".
 */
export function notScoredText(week, index) {
  return { title: index === 0 ? 'This week has not been scored' : `The week of ${week} has not been scored` };
}

/** "Scored 09-11-2026 06:00 · automatically" or "… · <name>": when, and who or what scored it. */
export function scoredText(list, when) {
  if (list.scoredBySchedule) return `Scored ${when} · automatically`;
  return `Scored ${when}${list.scoredBy ? ` · ${list.scoredBy}` : ''}`;
}

/**
 * A ranked school's reasons without the "Needs review:" verdict the scoring service puts
 * in front. Schools below the list were not listed, so only the reasons are shown for them.
 */
export function withoutVerdict(explanation) {
  return (explanation || '').replace(/^Needs review:\s*/, '');
}

/** A school's reasons as a list, each starting with a capital: "a; b" → ["A", "B"]. */
export function reasonList(explanation) {
  return withoutVerdict(explanation).split(/;\s*/).map((r) => r.trim()).filter(Boolean)
    .map((r) => r.charAt(0).toUpperCase() + r.slice(1));
}

export const DECISIONS = {
  explained: { label: 'Explained', tone: 'success' },
  follow_up: { label: 'Follow-up', tone: 'warning' },
};

/** A note for weeks not ranked the usual way; the usual way (the model) needs none. */
export const MODES = {
  rules_only: 'Fixed checks only: not enough records yet to compare schools',
  // Only school days are ranked, so a week can have records and still have none to rank
  no_records: 'No school-day records for this week yet',
};

/**
 * The week's fixed-check breaches with the same school and finding on several days,
 * folded into one line each: { key, schoolName, detail, dates }.
 */
export function groupBreaches(breaches) {
  const groups = new Map();
  for (const b of breaches || []) {
    const key = `${b.schoolId}|${b.rule}|${b.detail}`;
    if (!groups.has(key)) groups.set(key, { key, schoolName: b.schoolName, detail: b.detail, dates: [] });
    groups.get(key).dates.push(b.date);
  }
  return [...groups.values()];
}
