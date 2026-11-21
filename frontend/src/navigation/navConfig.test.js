import { describe, expect, it } from 'vitest';
import { allItems, visibleGroups } from './navConfig';

const paths = (who) => allItems(who).map((item) => item.to);

describe('who sees which pages', () => {
  it('shows the system administrator accounts, devices, the school calendar and settings, and no school records', () => {
    const admin = paths({ isAdmin: true, role: 'admin' });

    expect(admin).toEqual(['/', '/users', '/devices', '/calendar', '/settings']);
  });

  it('shows the programme officer the oversight pages', () => {
    const officer = paths({ isAdmin: false, role: 'programme_officer' });

    expect(officer).toEqual(['/', '/analytics', '/conflicts', '/review', '/weekly-review', '/enrolment-checks', '/settings']);
    expect(officer).not.toContain('/today');
  });

  it('does not show the programme officer Sync, since officers queue nothing on a device', () => {
    expect(paths({ isAdmin: false, role: 'programme_officer' })).not.toContain('/sync');
  });

  it('puts the officer\'s decisions under To do and Analytics beside the dashboard', () => {
    const groups = visibleGroups({ isAdmin: false, role: 'programme_officer' }).map((g) => [g.label, g.items.map((i) => i.to)]);
    expect(groups).toContainEqual(['To do', ['/conflicts', '/review', '/weekly-review', '/enrolment-checks']]);
    expect(groups).toContainEqual(['Overview', ['/', '/analytics']]);
  });

  it('puts the feeding teacher\'s Sync with the school pages, not under a heading of its own', () => {
    const groups = visibleGroups({ isAdmin: false, role: 'school_staff' }).map((g) => [g.label, g.items.map((i) => i.to)]);
    expect(groups).toContainEqual(['School', ['/today', '/stock', '/term', '/enrolment', '/sync']]);
  });

  it('shows the feeding teacher the school pages only', () => {
    const teacher = paths({ isAdmin: false, role: 'school_staff' });

    expect(teacher).toEqual(expect.arrayContaining(['/today', '/stock', '/enrolment', '/term', '/sync']));
    expect(teacher).not.toContain('/analytics');
    expect(teacher).not.toContain('/');
  });
});
