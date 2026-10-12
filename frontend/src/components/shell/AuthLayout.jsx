import { Outlet } from 'react-router-dom';

/**
 * Frame for signing in, before anyone has signed in on this device: no navigation.
 */
function AuthLayout() {
  return (
    <div className="auth-layout">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <main id="main-content" className="auth-layout__main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}

export default AuthLayout;
