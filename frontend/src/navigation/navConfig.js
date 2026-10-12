import {
  LayoutDashboard,
  ClipboardCheck,
  Utensils,
  BarChart3,
  TrendingUp,
  RefreshCw,
  GitCompareArrows,
  Settings,
} from 'lucide-react';

/**
 * The one navigation config. It is rendered three ways: a sidebar (desktop), an
 * icon strip (tablet) and a bottom tab bar plus "More" sheet (mobile).
 *
 * mobileTab: shown in the bottom tab bar (the rest go in "More")
 * adminOnly: only shown to administrators
 * badge: name of a live count shown next to the item
 */
export const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, mobileTab: true }],
  },
  {
    label: 'Record',
    items: [
      { to: '/attendance', label: 'Attendance', icon: ClipboardCheck, mobileTab: true },
      { to: '/meals', label: 'Meals', icon: Utensils, mobileTab: true },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/reports', label: 'Reports', icon: BarChart3 },
      { to: '/forecast', label: 'Forecast', icon: TrendingUp },
    ],
  },
  {
    label: 'Data sync',
    items: [
      { to: '/sync', label: 'Sync Status', shortLabel: 'Sync', icon: RefreshCw, mobileTab: true },
      { to: '/conflicts', label: 'Conflicts', icon: GitCompareArrows, adminOnly: true, badge: 'conflicts' },
    ],
  },
  {
    label: null,
    items: [{ to: '/settings', label: 'Settings', icon: Settings }],
  },
];

/**
 * Groups with the items this user may see.
 */
export function visibleGroups({ isAdmin }) {
  return NAV_GROUPS
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.adminOnly || isAdmin) }))
    .filter((group) => group.items.length > 0);
}

export function allItems({ isAdmin }) {
  return visibleGroups({ isAdmin }).flatMap((group) => group.items);
}
