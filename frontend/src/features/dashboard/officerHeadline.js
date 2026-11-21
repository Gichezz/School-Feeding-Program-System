import { formatNumber } from '../../utils/format';

/**
 * The officer dashboard's headline, built from the same work list shown under it, so the
 * two can never disagree. Rows whose count is not known yet (unknown: true) are left out:
 * the headline then says only how the term stands.
 *
 * term: { label, closed } or null; items: the work list rows
 */
export function officerHeadline(term, items) {
  if (!term) return 'Your work for the sub-county';
  const state = term.closed ? `${term.label} has closed.` : `${term.label} is under way.`;
  const waiting = items.filter((item) => !item.done && !item.unknown).length;
  if (waiting > 0) {
    return `${state} ${formatNumber(waiting)} ${waiting === 1 ? 'thing is' : 'things are'} waiting for you.`;
  }
  if (items.some((item) => item.unknown)) return state;
  return `${state} Nothing is waiting for you.`;
}
