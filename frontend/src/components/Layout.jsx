import { Link, Outlet } from 'react-router-dom';
import Header from './Header';
import Navigation from './Navigation';
import Footer from './Footer';
import { useSession } from '../hooks/useSession';

/**
 * Shared page chrome: header, navigation, main content, footer.
 */
function Layout() {
  const { session, isValid } = useSession();

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <Header />
      {session && <Navigation />}
      <main id="main-content" className="site-main" tabIndex={-1}>
        {session && !isValid && (
          <div className="form-warning" role="status">
            Your sign-in has expired. You can keep recording on this device;{' '}
            <Link to="/login">sign in again</Link> to sync.
          </div>
        )}
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

export default Layout;
