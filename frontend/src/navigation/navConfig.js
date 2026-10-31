import {
  LayoutDashboard,
  CalendarCheck,
  Warehouse,
  Users,
  FileText,
  BarChart3,
  RefreshCw,
  GitCompareArrows,
  Flag,
  ListChecks,
  Settings,
} from 'lucide-react';

/**
 * The one navigation config. It is rendered three ways: a sidebar (desktop), an
 * icon strip (tablet) and a bottom tab bar plus "More" sheet (mobile).
 *
 * mobileTab: shown in the bottom tab bar (the rest go in "More")
 * adminOnly: only shown to administrators
 * staffOnly: only shown to school staff, who record on the school's devices
 * notStaff: not shown to school staff
 * oversight: only shown to programme officers and administrators
 * badge: name of a live count shown next to the item
 */
export const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, mobileTab: true, notStaff: true }],
  },
  {
    label: 'School',
    items: [
      { to: '/today', label: 'Today', icon: CalendarCheck, mobileTab: true, staffOnly: true },
      { to: '/stock', label: 'Stock', icon: Warehouse, mobileTab: true, staffOnly: true },
      { to: '/enrolment', label: 'Enrolment', icon: Users, staffOnly: true },
      { to: '/term', label: 'Term plan and report', shortLabel: 'Term', icon: FileText, mobileTab: true, staffOnly: true },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/weekly-review', label: 'Weekly review', shortLabel: 'Weekly', icon: ListChecks, oversight: true },
      { to: '/reports', label: 'Reports', icon: BarChart3, notStaff: true },
    ],
  },
  {
    label: 'Data sync',
    items: [
      { to: '/sync', label: 'Sync Status', shortLabel: 'Sync', icon: RefreshCw, mobileTab: true },
      { to: '/conflicts', label: 'Conflicts', icon: GitCompareArrows, adminOnly: true, badge: 'conflicts' },
      { to: '/review', label: 'Record review', shortLabel: 'Review', icon: Flag, adminOnly: true, badge: 'review' },
    ],
  },
  {
    label: null,
    items: [{ to: '/settings', label: 'Settings', icon: Settings }],
  },
];

function canSee(item, { isAdmin, role }) {
  const isStaff = role === 'school_staff';
  if (item.adminOnly && !isAdmin) return false;
  if (item.staffOnly && !isStaff) return false;
  if (item.notStaff && isStaff) return false;
  if (item.oversight && !isAdmin && role !== 'programme_officer') return false;
  return true;
}

/**
 * Groups with the items this user may see.
 */
export function visibleGroups({ isAdmin, role }) {
  return NAV_GROUPS
    .map((group) => ({ ...group, items: group.items.filter((item) => canSee(item, { isAdmin, role })) }))
    .filter((group) => group.items.length > 0);
}

export function allItems({ isAdmin, role }) {
  return visibleGroups({ isAdmin, role }).flatMap((group) => group.items);
}
