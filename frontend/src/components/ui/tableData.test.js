import { describe, expect, it } from 'vitest';
import { filterRows, resultText, searchRows, sortRows } from './tableData';

const schools = [
  { name: 'Amani Primary', days: 12, type: 'in_kind' },
  { name: 'Baraka Primary', days: null, type: 'cash' },
  { name: 'Jamhuri School', days: 3, type: 'in_kind' },
];

describe('searchRows', () => {
  it('keeps rows that contain every word, ignoring case', () => {
    expect(searchRows(schools, 'primary AMANI', (s) => [s.name]).map((s) => s.name)).toEqual(['Amani Primary']);
  });

  it('returns every row for an empty query', () => {
    expect(searchRows(schools, '  ', (s) => [s.name])).toHaveLength(3);
  });
});

describe('filterRows', () => {
  const groups = [{ key: 'type', matches: (row, value) => row.type === value }];

  it('applies a chosen filter', () => {
    expect(filterRows(schools, groups, { type: 'cash' }).map((s) => s.name)).toEqual(['Baraka Primary']);
  });

  it('ignores filters with no value chosen', () => {
    expect(filterRows(schools, groups, { type: '' })).toHaveLength(3);
  });
});

describe('sortRows', () => {
  it('sorts numbers both ways with missing values last', () => {
    expect(sortRows(schools, (s) => s.days).map((s) => s.days)).toEqual([3, 12, null]);
    expect(sortRows(schools, (s) => s.days, 'descending').map((s) => s.days)).toEqual([12, 3, null]);
  });

  it('sorts text without changing the original list', () => {
    const sorted = sortRows(schools, (s) => s.name, 'descending');
    expect(sorted.map((s) => s.name)).toEqual(['Jamhuri School', 'Baraka Primary', 'Amani Primary']);
    expect(schools[0].name).toBe('Amani Primary');
  });
});

describe('resultText', () => {
  it('says how many are shown out of how many', () => {
    expect(resultText(12, 40, 'schools')).toBe('12 of 40 schools');
    expect(resultText(40, 40, 'schools')).toBe('40 schools');
  });
});
