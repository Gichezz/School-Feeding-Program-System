import { NavLink } from 'react-router-dom';
import { formatNumber } from '../../utils/format';

/**
 * One navigation link, shared by the sidebar, the icon strip and the More sheet.
 * The label stays in the DOM (visually hidden in the icon strip) so it is always announced.
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
