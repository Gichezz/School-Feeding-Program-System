import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { Alert, APP_NAME, Button, Card, FormField } from '../components/ui';
import LisheLogo from '../components/shell/LisheLogo';
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

  useEffect(() => {
    document.title = `Sign in · ${APP_NAME}`;
  }, []);

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
    <div className="login">
      <div className="login__brand">
        <LisheLogo withTagline className="login__logo" />
      </div>

      <Card>
        <form className="login__form" onSubmit={handleSubmit}>
          <div>
            <h1 className="login__title">Sign in</h1>
            <p className="login__intro">
              {user ? 'Sign in again to keep syncing. Records saved on this device are kept.' : 'Use the account your programme administrator gave you.'}
            </p>
          </div>

          {!isOnline && (
            <Alert tone="neutral" title="You are offline">Signing in needs a connection.</Alert>
          )}
          {error && <Alert tone="danger" title="Could not sign in">{error}</Alert>}

          <FormField
            id="login-email"
            label="Email"
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <FormField
            id="login-password"
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button type="submit" icon={LogIn} fullWidth loading={submitting} disabled={!isOnline}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

export default Login;
