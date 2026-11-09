import { formatDateTime, formatNumber } from '../../utils/format';
import { COMMODITY_LABELS, NOT_FED_REASONS, UNUSUAL_REASONS } from '../feeding/planning';

/**
 * Display helpers for record review (#62). Flags and history come from the server with
 * each record's values: attendance { date, registered, present, absent }; meals { date,
 * prepared, served }; daily feeding { date, happened, present, fed, cerealsKg, pulsesKg,
 * reason }; enrolment { term, class, sex, learners }; stock entries { date, kind,
 * commodity, quantityKg, noteQuantityKg, reference } and counts { date, commodity, countedKg }.
 */

export const ENTITY_LABELS = {
  attendance: 'Attendance',
  meal_distribution: 'Meals',
  daily_feeding: 'Daily feeding',
  enrolment: 'Enrolment',
  stock_movement: 'Stock entry',
  stock_count: 'Store count',
};

const KINDS = { delivery: 'Delivery', purchase: 'Purchase', loss: 'Loss', return: 'Return', reversal: 'Reversal' };
const REASONS = { ...NOT_FED_REASONS, ...UNUSUAL_REASONS };
// Kilograms keep their halves (food is recorded to the nearest 0.5 kg)
const kg = (value) => (value === null || value === undefined || value === ''
  ? '–'
  : `${Number(value).toLocaleString('en-GB', { maximumFractionDigits: 2 })} kg`);
const food = (commodity) => (COMMODITY_LABELS[commodity] || commodity || '').toLowerCase();

const VALUE_LABELS = {
  registered: 'Registered',
  present: 'Present',
  absent: 'Absent',
  prepared: 'Meals prepared',
  served: 'Meals served',
  fed: 'Learners fed',
  cerealsKg: 'Cereals issued',
  pulsesKg: 'Pulses issued',
  learners: 'Learners enrolled',
};

const VALUE_KEYS = {
  attendance: ['registered', 'present', 'absent'],
  meal_distribution: ['prepared', 'served'],
  daily_feeding: ['present', 'fed', 'cerealsKg', 'pulsesKg'],
  enrolment: ['learners'],
};

const KG_KEYS = new Set(['cerealsKg', 'pulsesKg']);
const show = (key, value) => (KG_KEYS.has(key) ? kg(value) : formatNumber(value));

/** What a flagged record is, for its heading: "Daily feeding · 06-10-2026". */
export function recordHeading(flag) {
  const v = flag.values || {};
  if (flag.entityType === 'enrolment') {
    const who = `${v.class || ''} ${v.sex === 'F' ? 'girls' : v.sex === 'M' ? 'boys' : ''}`.trim();
    return `Enrolment · ${[who, v.term].filter(Boolean).join(', ')}`;
  }
  if (flag.entityType === 'stock_movement') return `${KINDS[v.kind] || 'Stock entry'} of ${food(v.commodity)} · ${v.date}`;
  if (flag.entityType === 'stock_count') return `Store count of ${food(v.commodity)} · ${v.date}`;
  return `${ENTITY_LABELS[flag.entityType] || 'Record'} · ${v.date}`;
}

/** The record's own figures. */
function valueRows(flag) {
  const v = flag.values || {};
  if (flag.entityType === 'stock_movement') {
    return [
      { key: 'quantity', label: 'Received', value: kg(v.quantityKg) },
      ...(v.noteQuantityKg ? [{ key: 'note', label: 'On the delivery note', value: kg(v.noteQuantityKg) }] : []),
      ...(v.reference ? [{ key: 'reference', label: 'Delivery note or receipt', value: v.reference }] : []),
    ];
  }
  if (flag.entityType === 'stock_count') return [{ key: 'counted', label: 'Counted', value: kg(v.countedKg) }];
  const rows = (VALUE_KEYS[flag.entityType] || [])
    .filter((key) => !(flag.entityType === 'daily_feeding' && key === 'present' && (v.present === null || v.present === undefined)))
    .map((key) => ({ key, label: VALUE_LABELS[key], value: show(key, v[key]) }));
  if (flag.entityType === 'daily_feeding' && v.happened === false) {
    rows.unshift({ key: 'happened', label: 'Feeding happened', value: 'No' });
  }
  if (flag.entityType === 'daily_feeding' && v.reason) rows.push({ key: 'reason', label: 'Reason', value: REASONS[v.reason] || v.reason });
  return rows;
}

/**
 * Rows for the SummaryList of one flagged record: its figures, who captured it, on which
 * device, and when it was captured and received.
 */
export function flagSummaryRows(flag) {
  return [
    ...valueRows(flag),
    { key: 'by', label: 'Captured by', value: flag.capturedBy || 'Not recorded' },
    { key: 'device', label: 'Device', value: flag.device || 'Not a school device' },
    { key: 'captured', label: 'Captured', value: flag.capturedAt ? formatDateTime(flag.capturedAt) : 'Not recorded' },
    { key: 'received', label: 'Received', value: flag.receivedAt ? formatDateTime(flag.receivedAt) : 'Not recorded' },
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
        .map((key) => `${VALUE_LABELS[key]} ${show(key, previous.values?.[key])} → ${show(key, entry.values[key])}`)
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
