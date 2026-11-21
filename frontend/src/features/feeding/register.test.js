import { describe, expect, it } from 'vitest';
import { registerWeeks, termSentence, monthLabels } from './register';

const day = (date, weekday, kind, extra = {}) => ({ date, weekday, kind, ...extra });

describe('registerWeeks', () => {
  it('starts a new row each Monday and pads a mid-week start', () => {
    const weeks = registerWeeks([
      day('02-09-2026', 3, 'fed'), day('03-09-2026', 4, 'fed'), day('04-09-2026', 5, 'fed'),
      day('07-09-2026', 1, 'fed'),
    ]);

    expect(weeks).toHaveLength(2);
    expect(weeks[0].map((c) => c && c.date)).toEqual([null, null, '02-09-2026', '03-09-2026', '04-09-2026']);
    expect(weeks[1][0].date).toBe('07-09-2026');
  });
});

describe('termSentence', () => {
  const summary = { fed: 34, schoolDays: 44, notFed: 10, notRecorded: 0, upcoming: 0, lastFed: '08-10-2026' };

  it('says how many school days were fed', () => {
    expect(termSentence(summary, []).text).toBe('34 of 44 school days fed this term.');
    expect(termSentence({ ...summary, upcoming: 5 }, []).text).toBe('34 of 44 school days fed so far this term.');
  });

  it('says when a school has stopped feeding, with the reason given', () => {
    const days = [
      day('08-10-2026', 4, 'fed'),
      day('09-10-2026', 5, 'not_fed', { reason: 'no_food' }),
      day('12-10-2026', 1, 'not_fed', { reason: 'no_food' }),
      day('13-10-2026', 2, 'not_recorded'),
    ];

    expect(termSentence(summary, days).stopped)
      .toBe('No feeding since 08-10-2026: the last 3 school days, with “No food in the store” given as the reason.');
  });

  it('says nothing more for one or two missed days', () => {
    const days = [day('08-10-2026', 4, 'fed'), day('09-10-2026', 5, 'not_fed', { reason: 'cook_absent' })];

    expect(termSentence(summary, days).stopped).toBeNull();
  });
});

describe('monthLabels', () => {
  it('names the month on the first day shown and where a new month starts', () => {
    const days = ['29-09-2026', '30-09-2026', '01-10-2026', '02-10-2026'].map((date) => ({ date }));
    expect([...monthLabels(days)]).toEqual([['29-09-2026', 'Sep'], ['01-10-2026', 'Oct']]);
  });
});
