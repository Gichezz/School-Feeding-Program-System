import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageIntro from '../components/PageIntro';
import { login } from '../services/api';
import { saveSession } from '../services/session';
import { manualSync } from '../sync/syncManager';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useSession } from '../hooks/useSession';

/**
 * Sign-in page. Needs a connection; records captured offline stay on the device
 * and sync after signing in.
 */
function Login() {
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const { user } = useSession();
  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const session = await login(email.trim(), password);
      saveSession(session);
      // Send anything queued while the previous session was missing or expired
      manualSync().catch(() => {});
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.status === 401 || err.status === 400 ? err.message : 'Could not reach the server. Try again when you are online.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageIntro title="Sign in" purpose="Sign in to record attendance and meals and to sync with the central server">
      <section className="form-section">
        {!isOnline && (
          <div className="form-warning" role="status">
            You are offline. Signing in needs a connection.
          </div>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn--primary" disabled={submitting || !isOnline}>
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
        </form>
      </section>
    </PageIntro>
  );
}

export default Login;
