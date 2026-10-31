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

export const DECISIONS = {
  explained: { label: 'Explained', tone: 'success' },
  follow_up: { label: 'Follow-up', tone: 'warning' },
};

export const MODES = {
  one_class_svm: 'Ranked by the one-class SVM, trained on the sub-county’s previous 125 school days (about two terms). The fixed checks run alongside.',
  rules_only: 'Ranked by the fixed checks only: the sub-county has fewer than 60 school days of records, too few to learn what is usual.',
  no_records: 'No feeding records have synced for this week yet.',
};
