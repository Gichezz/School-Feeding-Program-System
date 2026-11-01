import { describe, expect, it } from 'vitest';
import { describeHeld } from './heldTypes';

describe('describeHeld', () => {
  it('describes a delivery held as a possible duplicate', () => {
    const shown = describeHeld({
      entityType: 'stockMovement',
      payload: { kind: 'delivery', commodity: 'cereals', movementDate: '05-10-2026', quantityKg: 500, noteQuantityKg: 500, reference: 'DN-2026-114' },
    });

    expect(shown.title).toBe('Delivery of cereals');
    expect(shown.when).toBe('05-10-2026');
    expect(shown.rows).toEqual([
      { key: 'quantity', label: 'Received', value: '500 kg' },
      { key: 'note', label: 'On the delivery note', value: '500 kg' },
      { key: 'reference', label: 'Delivery note or receipt', value: 'DN-2026-114' },
    ]);
  });

  it('describes a daily feeding record with its own fields', () => {
    const shown = describeHeld({
      entityType: 'dailyFeeding',
      payload: { feedingDate: '06-10-2026', feedingHappened: true, learnersFed: 400, cerealsKg: 60, pulsesKg: 16 },
    });

    expect(shown.title).toBe('Daily feeding record');
    expect(shown.rows.find((r) => r.key === 'learnersFed').value).toBe('400');
  });

  it('still describes the older attendance records', () => {
    expect(describeHeld({ entityType: 'attendance', payload: { attendanceDate: '06-10-2026' } }).title).toBe('Attendance');
  });
});
