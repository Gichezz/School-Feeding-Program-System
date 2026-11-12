/**
 * Search, filter, sort and paging for DataTable. Works only on rows that are
 * already loaded; nothing here calls the server.
 */

/** Text for searching, sorting and comparing: lower case, trimmed. */
const norm = (value) => (value === null || value === undefined ? '' : String(value).trim().toLowerCase());

/**
 * Rows whose search text contains every word of the query.
 *
 * @param {object[]} rows
 * @param {string} query
 * @param {(row: object) => string[]} textOf - the values to search in, e.g. name and email
 */
export function searchRows(rows, query, textOf) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return rows;
  return rows.filter((row) => {
    const text = textOf(row).map(norm).join(' ');
    return words.every((word) => text.includes(word));
  });
}

/**
 * Rows that match every chosen filter. A filter with no chosen value is ignored.
 *
 * @param {object[]} rows
 * @param {{ key: string, matches: (row: object, value: string) => boolean }[]} groups
 * @param {Record<string, string>} chosen - { groupKey: optionValue }
 */
export function filterRows(rows, groups, chosen) {
  const active = groups.filter((group) => chosen[group.key]);
  if (active.length === 0) return rows;
  return rows.filter((row) => active.every((group) => group.matches(row, chosen[group.key])));
}

/**
 * Rows sorted by one value. Missing values (null, undefined, '') always go last,
 * whichever the direction, so blanks never crowd the top of a list.
 *
 * @param {object[]} rows
 * @param {(row: object) => unknown} valueOf
 * @param {'ascending' | 'descending'} direction
 */
export function sortRows(rows, valueOf, direction = 'ascending') {
  const sign = direction === 'descending' ? -1 : 1;
  const missing = (v) => v === null || v === undefined || v === '';
  return [...rows].sort((a, b) => {
    const x = valueOf(a);
    const y = valueOf(b);
    if (missing(x) || missing(y)) return missing(x) === missing(y) ? 0 : missing(x) ? 1 : -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
    return norm(x).localeCompare(norm(y), 'en', { numeric: true }) * sign;
  });
}

/**
 * "12 of 40 schools" style result count.
 */
export function resultText(shown, total, noun = 'rows') {
  return shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`;
}
