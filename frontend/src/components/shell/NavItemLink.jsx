import { NavLink } from 'react-router-dom';
import { formatNumber } from '../../utils/format';

/**
 * One navigation link, shared by the sidebar, the tablet rail and the More sheet.
 * The full label is always announced; the rail shows the short label under the icon.
 */
function NavItemLink({ item, count, onNavigate, className = 'app-nav__link' }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => `${className}${isActive ? ` ${className}--active` : ''}`}
      title={item.label}
      onClick={onNavigate}
    >
      <Icon className="app-nav__icon" aria-hidden="true" />
      <span className="app-nav__label">{item.label}</span>
      <span className="app-nav__short" aria-hidden="true">{item.shortLabel || item.label}</span>
      {count > 0 && (
        <span className="app-nav__count">
          {formatNumber(count)}
          <span className="visually-hidden"> unresolved</span>
        </span>
      )}
    </NavLink>
  );
}

export default NavItemLink;
