import { describe, expect, it } from 'vitest';
import { allItems } from './navConfig';

const paths = (who) => allItems(who).map((item) => item.to);

describe('who sees which pages', () => {
  it('shows the system administrator accounts, devices and settings, and no school records', () => {
    const admin = paths({ isAdmin: true, role: 'admin' });

    expect(admin).toEqual(['/', '/settings']);
  });

  it('shows the programme officer the oversight pages', () => {
    const officer = paths({ isAdmin: false, role: 'programme_officer' });

    expect(officer).toEqual(expect.arrayContaining(['/', '/analytics', '/weekly-review', '/enrolment-checks', '/conflicts', '/review', '/sync']));
    expect(officer).not.toContain('/today');
  });

  it('shows the feeding teacher the school pages only', () => {
    const teacher = paths({ isAdmin: false, role: 'school_staff' });

    expect(teacher).toEqual(expect.arrayContaining(['/today', '/stock', '/enrolment', '/term', '/sync']));
    expect(teacher).not.toContain('/analytics');
    expect(teacher).not.toContain('/');
  });
});
