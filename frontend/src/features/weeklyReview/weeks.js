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
  if (index === 0) {
    return {
      title: 'This week has not been scored',
      description: 'It is scored automatically once it is over and its records have reached the server. To see it so far, score it now.',
    };
  }
  return {
    title: `The week of ${week} has not been scored`,
    description: 'A finished week is scored automatically once its records have reached the server. To see it now, score it here.',
  };
}

/** "Scored automatically on …." or "Scored on … by <name>.": who or what produced the list. */
export function scoredText(list, when) {
  if (list.scoredBySchedule) return `Scored automatically on ${when}.`;
  return `Scored on ${when}${list.scoredBy ? ` by ${list.scoredBy}` : ''}.`;
}

/**
 * A ranked school's reasons without the "Needs review:" verdict the scoring service puts
 * in front. Schools below the list were not listed, so only the reasons are shown for them.
 */
export function withoutVerdict(explanation) {
  return (explanation || '').replace(/^Needs review:\s*/, '');
}

export const DECISIONS = {
  explained: { label: 'Explained', tone: 'success' },
  follow_up: { label: 'Follow-up', tone: 'warning' },
};

export const MODES = {
  extended_isolation_forest: 'Ranked against each school’s own records and similar schools over about the last two terms.',
  // Weeks scored before the switch to Extended Isolation Forest (protocol version 6)
  one_class_svm: 'Ranked against each school’s own records and similar schools over about the last two terms.',
  rules_only: 'Ranked by the fixed checks only, until there are enough records to compare schools.',
  // Only school days are ranked, so a week can have records and still have none to rank
  no_records: 'No feeding on a school day has reached the server for this week yet. Weekends, holidays and days outside the school terms are not ranked.',
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
