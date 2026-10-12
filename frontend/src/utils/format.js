/**
 * Shared formatting for numbers and dates, so every page shows them the same way:
 * thousands separators, percentages to 1 decimal place, dates as DD-MM-YYYY.
 */

const numberFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const PLACEHOLDER = '–';

function isMissing(value) {
  return value === null || value === undefined || value === '' || Number.isNaN(Number(value));
}

/**
 * 1234 → "1,234". Rounds to a whole number.
 */
export function formatNumber(value) {
  return isMissing(value) ? PLACEHOLDER : numberFormat.format(Number(value));
}

/**
 * Percentage to one decimal place. Pass a ratio (0.915) by default, or a value
 * that is already a percentage with { isRatio: false } (91.5).
 */
export function formatPercent(value, { isRatio = true } = {}) {
  if (isMissing(value)) return PLACEHOLDER;
  const percent = isRatio ? Number(value) * 100 : Number(value);
  return `${percent.toFixed(1)}%`;
}

/**
 * Percentage of part in whole, e.g. present of registered. "–" when whole is 0.
 */
export function formatShare(part, whole) {
  return !whole ? PLACEHOLDER : formatPercent(part / whole);
}

/**
 * A signed change for deltas: +12, −3 (true minus sign), 0.
 */
export function formatDelta(value) {
  if (isMissing(value)) return PLACEHOLDER;
  const n = Math.round(Number(value));
  if (n > 0) return `+${numberFormat.format(n)}`;
  if (n < 0) return `−${numberFormat.format(Math.abs(n))}`;
  return '0';
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Parse a Date, a DD-MM-YYYY string, a YYYY-MM-DD string or an ISO timestamp.
 * Calendar dates (no time part) are read as local dates, never shifted by time zone.
 */
export function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' || !value) return null;
  let match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Any supported date → "DD-MM-YYYY".
 */
export function formatDate(value) {
  const date = toDate(value);
  return date ? `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}` : PLACEHOLDER;
}

/**
 * Timestamp → "DD-MM-YYYY HH:mm" (24-hour, local time).
 */
export function formatDateTime(value) {
  const date = toDate(value);
  return date ? `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}` : PLACEHOLDER;
}

/**
 * Timestamp → "just now", "5 min ago", "2 h ago", "3 days ago"; older than a week → the date.
 */
export function formatRelativeTime(value, now = Date.now()) {
  const date = toDate(value);
  if (!date) return PLACEHOLDER;
  const seconds = Math.round((now - date.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? 'yesterday' : `${days} days ago`;
  return formatDate(date);
}

/**
 * Today's date as DD-MM-YYYY (local time).
 */
export function todayDate() {
  return formatDate(new Date());
}

/**
 * DD-MM-YYYY ↔ YYYY-MM-DD for <input type="date">.
 */
export function toInputDate(displayDate) {
  const date = toDate(displayDate);
  return date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : '';
}

export function fromInputDate(inputDate) {
  return inputDate ? formatDate(inputDate) : '';
}
