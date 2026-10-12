import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut } from 'lucide-react';
import { useSession } from '../../hooks/useSession';
import { clearSession } from '../../services/session';

export const ROLE_LABELS = { admin: 'Administrator', school_staff: 'School staff' };

export function initialsOf(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || '?';
}

/**
 * Signs the user out. Records saved on this device stay queued and sync after the next sign-in.
 */
export function useSignOut() {
  const navigate = useNavigate();
  return () => {
    clearSession();
    navigate('/', { replace: true });
  };
}

/**
 * The signed-in user's name and role, with a menu to sign out.
 */
function UserMenu() {
  const { user } = useSession();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;
  const role = ROLE_LABELS[user.role] || user.role;

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="user-menu__button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Account: ${user.name}, ${role}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="user-menu__avatar" aria-hidden="true">{initialsOf(user.name)}</span>
        <span className="user-menu__who">
          <span className="user-menu__name">{user.name}</span>
          <span className="user-menu__role">{role}</span>
        </span>
        <ChevronDown className="user-menu__chevron" aria-hidden="true" />
      </button>
      {open && (
        <div id={menuId} className="user-menu__panel">
          <p className="user-menu__panel-name">{user.name}</p>
          <p className="user-menu__panel-meta">{role}{user.email ? ` · ${user.email}` : ''}</p>
          <button type="button" className="user-menu__action" onClick={signOut}>
            <LogOut aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default UserMenu;
