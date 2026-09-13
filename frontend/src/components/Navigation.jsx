import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/attendance', label: 'Attendance' },
  { to: '/meals', label: 'Meal Distribution' },
  { to: '/sync', label: 'Synchronization Status' },
  { to: '/reports', label: 'Reports' },
  { to: '/settings', label: 'Settings' },
];

/**
 * Primary navigation for the main application sections.
 */
function Navigation() {
  return (
    <nav className="site-nav" aria-label="Main">
      <ul className="site-nav__list">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                isActive ? 'site-nav__link site-nav__link--active' : 'site-nav__link'
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default Navigation;
