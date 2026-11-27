import { describe, expect, it } from 'vitest';
import { groupBreaches, listRecord, notScoredText, reasonList, recentMondays, reviewWeeks, scoredText, weekLabel, withoutVerdict } from './weeks';

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

describe('reviewWeeks', () => {
  const now = new Date(2026, 10, 26); // Thursday 26 November 2026

  it('offers the last eight weeks when no term is known', () => {
    expect(reviewWeeks(now)).toEqual(recentMondays(now, 8));
  });

  it('reaches back to the first week of the term just ended', () => {
    const weeks = reviewWeeks(now, '24-08-2026');
    expect(weeks[0]).toBe('23-11-2026');
    expect(weeks.at(-1)).toBe('24-08-2026');
    expect(weeks).toHaveLength(14);
  });

  it('keeps at least eight weeks early in a term', () => {
    expect(reviewWeeks(now, '16-11-2026')).toHaveLength(8);
  });

  it('adds older weeks that were already scored, newest first', () => {
    const weeks = reviewWeeks(now, '24-08-2026', ['20-07-2026', '05-10-2026']);
    expect(weeks.at(-1)).toBe('20-07-2026');
    expect(weeks).toHaveLength(15);
  });
});

describe('notScoredText', () => {
  it('calls the current week this week', () => {
    expect(notScoredText('23-11-2026', 0).title).toBe('This week has not been scored');
  });

  it('names an earlier week instead of calling it this week', () => {
    const text = notScoredText('16-11-2026', 1);
    expect(text.title).toBe('The week of 16-11-2026 has not been scored');
  });
});

describe('scoredText', () => {
  it('says when the schedule scored the week', () => {
    expect(scoredText({ scoredBySchedule: true, scoredBy: null }, '09-11-2026 06:00')).toBe('Scored 09-11-2026 06:00 · automatically');
  });

  it('names the officer who scored it, when one did', () => {
    expect(scoredText({ scoredBySchedule: false, scoredBy: 'Amina Otieno' }, '09-11-2026 10:15')).toBe('Scored 09-11-2026 10:15 · Amina Otieno');
    expect(scoredText({ scoredBySchedule: false, scoredBy: null }, '09-11-2026 10:15')).toBe('Scored 09-11-2026 10:15');
  });
});

describe('withoutVerdict', () => {
  it('drops the "Needs review:" verdict and keeps the reasons', () => {
    expect(withoutVerdict('Needs review: enrolment 35% up on last term (651 learners); 514 learners fed'))
      .toBe('enrolment 35% up on last term (651 learners); 514 learners fed');
  });

  it('leaves other text alone and copes with a missing explanation', () => {
    expect(withoutVerdict('learners fed 12% above usual')).toBe('learners fed 12% above usual');
    expect(withoutVerdict(undefined)).toBe('');
  });
});

describe('groupBreaches', () => {
  it('folds the same finding at one school into one line with its dates', () => {
    const detail = 'enrolment 35% up on last term (651 learners)';
    const breaches = [
      { schoolId: 'a', schoolName: 'Demo Primary School', rule: 'enrolment', detail, date: '19-10-2026' },
      { schoolId: 'a', schoolName: 'Demo Primary School', rule: 'enrolment', detail, date: '21-10-2026' },
      { schoolId: 'b', schoolName: 'Amani Primary School', rule: 'ration', detail: 'cereals at 1.4 times the ration', date: '19-10-2026' },
    ];
    expect(groupBreaches(breaches)).toEqual([
      { key: `a|enrolment|${detail}`, schoolName: 'Demo Primary School', detail, dates: ['19-10-2026', '21-10-2026'] },
      { key: 'b|ration|cereals at 1.4 times the ration', schoolName: 'Amani Primary School', detail: 'cereals at 1.4 times the ration', dates: ['19-10-2026'] },
    ]);
  });
});

describe('listRecord', () => {
  it('adds up the decisions on listed schools since the term opened', () => {
    const weeks = [
      { week: '16-11-2026', listed: 2, decided: 1, followUp: 1, explained: 0 },
      { week: '31-08-2026', listed: 3, decided: 3, followUp: 2, explained: 1 },
      { week: '17-08-2026', listed: 1, decided: 1, followUp: 1, explained: 0 },
    ];
    expect(listRecord(weeks, '24-08-2026')).toEqual({ listed: 5, followUp: 3, explained: 1, toReview: 1 });
    expect(listRecord([], null)).toEqual({ listed: 0, followUp: 0, explained: 0, toReview: 0 });
  });
});

describe('reasonList', () => {
  it('splits the reasons into a list, each starting with a capital', () => {
    expect(reasonList("Needs review: learners fed 161% above the school's usual number; enrolment 35% up on last term"))
      .toEqual(["Learners fed 161% above the school's usual number", 'Enrolment 35% up on last term']);
    expect(reasonList(undefined)).toEqual([]);
  });
});
