import { useNavigate } from 'react-router-dom';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useSession } from '../hooks/useSession';
import { clearSession } from '../services/session';

/**
 * Application header with system name and school context.
 */
function Header() {
  const isOnline = useOnlineStatus();
  const { user } = useSession();
  const navigate = useNavigate();

  function handleSignOut() {
    // Records saved on this device stay queued and sync after the next sign-in
    clearSession();
    navigate('/', { replace: true });
  }

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <h1 className="site-header__title">School Feeding Programme</h1>
        <p className="site-header__subtitle">
          Offline-first attendance and meal distribution system
        </p>
        <div className="connection-status">
          <span className={`status-indicator ${isOnline ? 'status-indicator--online' : 'status-indicator--offline'}`}>
            {isOnline ? 'Online' : 'Offline'}
          </span>
          {user && (
            <>
              {' '}
              <span className="site-header__subtitle">
                {user.name} ({user.role === 'admin' ? 'Administrator' : 'School staff'})
              </span>{' '}
              <button type="button" className="btn btn--secondary" onClick={handleSignOut}>
                Sign out
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export default Header;
