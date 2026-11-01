import { describe, expect, it } from 'vitest';
import { recentMondays, weekLabel } from './weeks';

describe('recentMondays', () => {
  it('starts at the Monday of the current week', () => {
    // Thursday 8 October 2026
    expect(recentMondays(new Date(2026, 9, 8), 3)).toEqual(['05-10-2026', '28-09-2026', '21-09-2026']);
  });

  it('treats Sunday as the end of the week', () => {
    expect(recentMondays(new Date(2026, 9, 11), 1)).toEqual(['05-10-2026']);
    expect(recentMondays(new Date(2026, 9, 5), 1)).toEqual(['05-10-2026']);
  });

  it('crosses months and years', () => {
    expect(recentMondays(new Date(2027, 0, 1), 2)).toEqual(['28-12-2026', '21-12-2026']);
  });
});

describe('weekLabel', () => {
  it('says how far the list has been reviewed', () => {
    expect(weekLabel('05-10-2026', { listed: 3, decided: 1 }, 0)).toBe('Week of 05-10-2026 (this week) · 1 of 3 reviewed');
    expect(weekLabel('28-09-2026', null, 1)).toBe('Week of 28-09-2026 (last week) · not scored');
  });
});
