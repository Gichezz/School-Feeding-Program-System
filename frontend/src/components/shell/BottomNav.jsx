import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LogOut, MoreHorizontal, X } from 'lucide-react';
import NavItemLink from './NavItemLink';
import { allItems } from '../../navigation/navConfig';
import { useSession } from '../../hooks/useSession';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { useOpenFlagCount } from '../../features/review/useOpenFlagCount';
import { useSignOut } from './UserMenu';
import { formatNumber } from '../../utils/format';

/**
 * Sheet with the destinations that do not fit in the bottom tab bar.
 */
function MoreSheet({ items, counts, onClose }) {
  const signOut = useSignOut();
  const sheetRef = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    sheetRef.current?.querySelector('a, button')?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
      // Keep keyboard focus inside the open sheet
      if (event.key === 'Tab' && sheetRef.current) {
        const focusable = [...sheetRef.current.querySelectorAll('a, button')];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="more-sheet" role="presentation" onClick={onClose}>
      <div
        ref={sheetRef}
        className="more-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="more-sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="more-sheet__head">
          <h2 id="more-sheet-title" className="more-sheet__title">More</h2>
          <button type="button" className="more-sheet__close" onClick={onClose} aria-label="Close">
            <X aria-hidden="true" />
          </button>
        </div>
        <ul className="more-sheet__list">
          {items.map((item) => (
            <li key={item.to}>
              <NavItemLink item={item} count={item.badge ? counts[item.badge] : 0} onNavigate={onClose} className="more-sheet__link" />
            </li>
          ))}
          <li>
            <button type="button" className="more-sheet__link more-sheet__signout" onClick={signOut}>
              <LogOut className="app-nav__icon" aria-hidden="true" />
              <span className="app-nav__label">Sign out</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}

/**
 * Fixed bottom tab bar on phones: Dashboard, Attendance, Meals, Sync and More.
 */
function BottomNav() {
  const { isAdmin } = useSession();
  const { unresolvedConflicts, pendingCount } = useSyncStatus();
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const items = allItems({ isAdmin });
  const tabs = items.filter((item) => item.mobileTab);
  const moreItems = items.filter((item) => !item.mobileTab);
  const openFlags = useOpenFlagCount();
  const counts = { conflicts: unresolvedConflicts, review: openFlags };
  const moreActive = moreItems.some((item) => location.pathname.startsWith(item.to));
  const moreCount = moreItems.reduce((sum, item) => sum + (item.badge ? counts[item.badge] || 0 : 0), 0);

  return (
    <>
      <nav className="bottom-nav" aria-label="Main">
        <ul className="bottom-nav__list">
          {tabs.map((item) => {
            const Icon = item.icon;
            const showPending = item.to === '/sync' && pendingCount > 0;
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `bottom-nav__tab${isActive ? ' bottom-nav__tab--active' : ''}`}
                >
                  <span className="bottom-nav__icon-wrap">
                    <Icon className="bottom-nav__icon" aria-hidden="true" />
                    {showPending && <span className="bottom-nav__dot">{formatNumber(pendingCount)}</span>}
                  </span>
                  <span className="bottom-nav__label">{item.shortLabel || item.label}</span>
                  {showPending && <span className="visually-hidden">, {pendingCount} waiting to sync</span>}
                </NavLink>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              className={`bottom-nav__tab${moreActive ? ' bottom-nav__tab--active' : ''}`}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(true)}
            >
              <span className="bottom-nav__icon-wrap">
                <MoreHorizontal className="bottom-nav__icon" aria-hidden="true" />
                {moreCount > 0 && <span className="bottom-nav__dot">{formatNumber(moreCount)}</span>}
              </span>
              <span className="bottom-nav__label">More</span>
            </button>
          </li>
        </ul>
      </nav>
      {moreOpen && <MoreSheet items={moreItems} counts={counts} onClose={() => setMoreOpen(false)} />}
    </>
  );
}

export default BottomNav;
