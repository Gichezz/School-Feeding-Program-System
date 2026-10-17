import { formatDateTime, formatNumber } from '../../utils/format';

/**
 * Display helpers for record review (#62). Flags and history come from the server
 * with each record's values as { date, registered, present, absent } (attendance)
 * or { date, prepared, served } (meals).
 */

export const ENTITY_LABELS = { attendance: 'Attendance', meal_distribution: 'Meals' };

const VALUE_LABELS = {
  registered: 'Registered',
  present: 'Present',
  absent: 'Absent',
  prepared: 'Meals prepared',
  served: 'Meals served',
};

const COUNT_KEYS = {
  attendance: ['registered', 'present', 'absent'],
  meal_distribution: ['prepared', 'served'],
};

/**
 * Rows for the SummaryList of one flagged record: its numbers, who captured it, on
 * which device, and when it was captured and received.
 */
export function flagSummaryRows(flag) {
  const counts = (COUNT_KEYS[flag.entityType] || []).map((key) => ({
    key,
    label: VALUE_LABELS[key],
    value: formatNumber(flag.values?.[key]),
  }));
  return [
    ...counts,
    { key: 'by', label: 'Captured by', value: flag.capturedBy || 'Not recorded' },
    { key: 'device', label: 'Device', value: flag.device || 'Not a school device' },
    { key: 'captured', label: 'Captured', value: flag.capturedAt ? formatDateTime(flag.capturedAt) : 'Not recorded' },
    { key: 'received', label: 'Reached the server', value: flag.receivedAt ? formatDateTime(flag.receivedAt) : 'Not recorded' },
    ...(flag.lateReason ? [{ key: 'reason', label: 'Reason for late entry', value: flag.lateReason }] : []),
  ];
}

/**
 * What changed in each saved version compared with the one before, oldest first:
 * [{ version, changes: ['Present 90 → 85'], first, changedBy, device, changedAt }]
 */
export function historyChanges(history) {
  return history.map((entry, index) => {
    const previous = history[index - 1];
    const changes = previous
      ? Object.keys(VALUE_LABELS)
        .filter((key) => entry.values?.[key] !== undefined && entry.values[key] !== previous.values?.[key])
        .map((key) => `${VALUE_LABELS[key]} ${formatNumber(previous.values?.[key])} → ${formatNumber(entry.values[key])}`)
      : [];
    return {
      version: entry.version,
      first: !previous,
      changes,
      changedBy: entry.changedBy || 'Unknown',
      device: entry.device,
      changedAt: entry.changedAt,
    };
  });
}
