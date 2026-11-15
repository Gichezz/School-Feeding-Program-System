import { describe, expect, it } from 'vitest';
import { calendarItems } from './SystemDashboard';

const status = (overrides = {}) => ({
  nextYear: 2027, missingTerms: [1, 2, 3], termsReminder: false, toConfirm: [], calendarEnded: false, ...overrides,
});

describe('the administrator\'s school calendar to-dos', () => {
  it('shows nothing before next year\'s terms are due', () => {
    expect(calendarItems(status())).toEqual([]);
    expect(calendarItems(null)).toEqual([]);
  });

  it('asks for next year\'s terms from 1 November, naming any still missing', () => {
    expect(calendarItems(status({ termsReminder: true }))[0]).toMatchObject({
      key: 'terms', to: '/calendar', title: 'Enter the 2027 school terms from the Ministry circular',
    });
    expect(calendarItems(status({ termsReminder: true, missingTerms: [2, 3] }))[0].title)
      .toBe('Enter the 2027 Term 2 and Term 3 from the Ministry circular');
  });

  it('says plainly when no term is left at all', () => {
    expect(calendarItems(status({ calendarEnded: true, termsReminder: true }))[0].title)
      .toBe('No school term is in the calendar after today');
  });

  it('shows the terms as done once all three are in', () => {
    expect(calendarItems(status({ missingTerms: [] }))).toEqual([expect.objectContaining({ key: 'terms', done: true })]);
  });

  it('asks to confirm estimated holidays', () => {
    const one = calendarItems(status({ toConfirm: [{ id: 'e', name: 'Eid al-Fitr', startsOn: '09-03-2027' }] }));
    const two = calendarItems(status({ toConfirm: [{ name: 'Eid al-Fitr', startsOn: '09-03-2027' }, { name: 'Christmas Day', startsOn: '27-12-2033' }] }));

    expect(one).toEqual([expect.objectContaining({ key: 'confirm', to: '/calendar', title: 'Confirm the date of Eid al-Fitr 2027' })]);
    expect(two[0].title).toBe('2 holiday dates to confirm');
  });
});
