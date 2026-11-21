import { describe, expect, it } from 'vitest';
import { officerHeadline } from './officerHeadline';

const term = { label: 'Term 3 2026', closed: false };

describe('officerHeadline', () => {
  it('counts what the work list shows as waiting, so the two never disagree', () => {
    const items = [{ key: 'cantJudge' }, { key: 'weekly' }, { key: 'flags', done: true }];
    expect(officerHeadline(term, items)).toBe('Term 3 2026 is under way. 2 things are waiting for you.');
    expect(officerHeadline(term, [{ key: 'weekly' }])).toBe('Term 3 2026 is under way. 1 thing is waiting for you.');
  });

  it('says nothing is waiting only when every count is known and done', () => {
    expect(officerHeadline(term, [{ key: 'flags', done: true }])).toBe('Term 3 2026 is under way. Nothing is waiting for you.');
    expect(officerHeadline(term, [{ key: 'flags', done: true }, { key: 'conflicts', unknown: true }])).toBe('Term 3 2026 is under way.');
  });

  it('says when the term has closed, and has a plain title before the term loads', () => {
    expect(officerHeadline({ label: 'Term 2 2026', closed: true }, [])).toBe('Term 2 2026 has closed. Nothing is waiting for you.');
    expect(officerHeadline(null, [])).toBe('Your work for the sub-county');
  });
});
