import { useState } from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import LisheLogo from './LisheLogo';
import NavItemLink from './NavItemLink';
import { visibleGroups } from '../../navigation/navConfig';
import { useSession } from '../../hooks/useSession';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { useOpenFlagCount } from '../../features/review/useOpenFlagCount';

/**
 * Left navigation. Desktop: full sidebar. Tablet: a narrow icon strip that expands
 * on hover, keyboard focus or the expand button. Hidden on mobile (bottom tabs instead).
 */
function Sidebar() {
  const { isAdmin } = useSession();
  const { unresolvedConflicts } = useSyncStatus();
  const [expanded, setExpanded] = useState(false);
  const openFlags = useOpenFlagCount();
  const counts = { conflicts: unresolvedConflicts, review: openFlags };

  return (
    <aside className="app-sidebar" data-expanded={expanded}>
      <div className="app-sidebar__brand">
        <LisheLogo />
      </div>
      <button
        type="button"
        className="app-sidebar__toggle"
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? <ChevronsLeft aria-hidden="true" /> : <ChevronsRight aria-hidden="true" />}
      </button>
      <nav className="app-nav" aria-label="Main">
        {visibleGroups({ isAdmin }).map((group, index) => (
          <div key={group.label || index} className="app-nav__group">
            {group.label && <p className="app-nav__heading">{group.label}</p>}
            <ul className="app-nav__list">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavItemLink item={item} count={item.badge ? counts[item.badge] : 0} onNavigate={() => setExpanded(false)} />
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
