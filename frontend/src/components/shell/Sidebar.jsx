import LisheLogo from './LisheLogo';
import NavItemLink from './NavItemLink';
import { visibleGroups } from '../../navigation/navConfig';
import { useSession } from '../../hooks/useSession';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { useOpenFlagCount } from '../../features/review/useOpenFlagCount';
import { useServerConflictCount } from '../../features/conflicts/useServerConflictCount';

/**
 * Left navigation. Desktop: full sidebar with group headings. Tablet: a labelled
 * rail, each item an icon with its short label underneath (never an icon alone).
 * Hidden on mobile (bottom tabs instead).
 */
function Sidebar() {
  const { isAdmin, user } = useSession();
  const { unresolvedConflicts } = useSyncStatus();
  const openFlags = useOpenFlagCount();
  // Officers and administrators count the server's conflicts; a school device its own
  const serverConflicts = useServerConflictCount();
  const counts = { conflicts: serverConflicts ?? unresolvedConflicts, review: openFlags };

  return (
    <aside className="app-sidebar">
      <div className="app-sidebar__brand">
        <LisheLogo />
      </div>
      <nav className="app-nav" aria-label="Main">
        {visibleGroups({ isAdmin, role: user?.role }).map((group, index) => (
          <div key={group.label || index} className="app-nav__group">
            {group.label && <p className="app-nav__heading">{group.label}</p>}
            <ul className="app-nav__list">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavItemLink item={item} count={item.badge ? counts[item.badge] : 0} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

export default Sidebar;
