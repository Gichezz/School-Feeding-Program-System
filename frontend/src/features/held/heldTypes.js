import { ATTENDANCE, MEALS } from '../recording/recordTypes';
import { COMMODITY_LABELS } from '../feeding/planning';
import { conflictType, showValue } from '../conflicts/conflictTypes';
import { formatDate, formatNumber } from '../../utils/format';

/**
 * How a held record is shown: a title, the date or term it is for, and its values.
 * Covers every record a school device sends.
 */

const KINDS = { delivery: 'Delivery', purchase: 'Purchase', loss: 'Loss', return: 'Return', reversal: 'Reversal' };
// Kilograms keep their halves (food is recorded to the nearest 0.5 kg)
const kg = (value) => (value === null || value === undefined || value === ''
  ? '–'
  : `${Number(value).toLocaleString('en-GB', { maximumFractionDigits: 2 })} kg`);

export function describeHeld(record) {
  const p = record.payload || {};
  if (record.entityType === 'stockMovement') {
    return {
      title: `${KINDS[p.kind] || 'Stock entry'} of ${(COMMODITY_LABELS[p.commodity] || p.commodity || '').toLowerCase()}`,
      when: formatDate(p.movementDate),
      rows: [
        { key: 'quantity', label: 'Received', value: kg(p.quantityKg) },
        ...(p.noteQuantityKg ? [{ key: 'note', label: 'On the delivery note', value: kg(p.noteQuantityKg) }] : []),
        ...(p.reference ? [{ key: 'reference', label: 'Delivery note or receipt', value: p.reference }] : []),
        ...(p.note ? [{ key: 'why', label: 'Note', value: p.note }] : []),
      ],
    };
  }
  if (record.entityType === 'stockCount') {
    return {
      title: `Store count of ${(COMMODITY_LABELS[p.commodity] || p.commodity || '').toLowerCase()}`,
      when: formatDate(p.countDate),
      rows: [{ key: 'counted', label: 'Counted', value: kg(p.countedKg) }],
    };
  }
  const versioned = conflictType(record.entityType);
  if (versioned && (record.entityType === 'dailyFeeding' || record.entityType === 'enrolment')) {
    return {
      title: versioned.title,
      when: versioned.when(p, {}),
      rows: versioned.fields.map((field) => ({ key: field.name, label: field.label, value: showValue(field, p[field.name]) })),
    };
  }
  const type = record.entityType === 'attendance' ? ATTENDANCE : MEALS;
  return {
    title: type.title,
    when: formatDate(p[type.dateField]),
    rows: type.fields.map((field) => ({ key: field.name, label: field.label, value: formatNumber(p[field.name]) })),
  };
}
