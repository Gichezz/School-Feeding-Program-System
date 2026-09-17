import { useOnlineStatus } from '../hooks/useOnlineStatus';

/**
 * Application header with system name and school context.
 */
function Header() {
  const isOnline = useOnlineStatus();

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
        </div>
      </div>
    </header>
  );
}

export default Header;
