import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Fingerprint, LifeBuoy, LogIn } from 'lucide-react';
import { Alert, APP_NAME, Button, Card, FormField, useToast } from '../components/ui';
import LisheLogo from '../components/shell/LisheLogo';
import { login, signInWithRecoveryCode } from '../services/api';
import { saveSession } from '../services/session';
import { manualSync } from '../sync/syncManager';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useSession } from '../hooks/useSession';
import { passkeyErrorMessage, passkeysSupported, signInWithPasskey } from '../features/passkeys/passkeyClient';

const OFFLINE_MESSAGE = 'Could not reach the server. Try again when you are online.';

/**
 * Sign-in page. Needs a connection; records captured offline stay on the device
 * and sync after signing in. Administrators sign in with a passkey (#57); if they
 * cannot use one, they sign in with their password and a recovery code.
 */
function Login() {
  const navigate = useNavigate();
  const toast = useToast();
  const isOnline = useOnlineStatus();
  const { user } = useSession();
  const canUsePasskeys = passkeysSupported();
  const [mode, setMode] = useState('password'); // 'password' | 'recovery'
  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [passkeyRequired, setPasskeyRequired] = useState(false);
  const [busy, setBusy] = useState(null); // 'password' | 'passkey' | 'recovery'

  useEffect(() => {
    document.title = `Sign in · ${APP_NAME}`;
  }, []);

  function finish(session, destination = '/') {
    saveSession(session);
    // Send anything queued while the previous session was missing or expired
    manualSync().catch(() => {});
    navigate(destination, { replace: true });
  }

  async function run(kind, action) {
    setError(null);
    setBusy(kind);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  }

  const handlePassword = (event) => {
    event.preventDefault();
    return run('password', async () => {
      try {
        finish(await login(email.trim(), password));
      } catch (err) {
        if (err.data?.passkeyRequired) {
          setPasskeyRequired(true);
          return;
        }
        setError(err.status === 401 || err.status === 400 ? err.message : OFFLINE_MESSAGE);
      }
    });
  };

  const handlePasskey = () => run('passkey', async () => {
    try {
      finish(await signInWithPasskey());
    } catch (err) {
      setError(err.status ? err.message : passkeyErrorMessage(err));
    }
  });

  const handleRecovery = (event) => {
    event.preventDefault();
    return run('recovery', async () => {
      try {
        const session = await signInWithRecoveryCode(email.trim(), password, code.trim());
        toast.show({
          tone: 'warning',
          title: 'Signed in with a recovery code',
          description: `${session.recoveryCodesLeft} left. If you lost a passkey, remove it and add a new one here.`,
        });
        finish(session, '/settings#passkeys');
      } catch (err) {
        setError(err.status === 401 || err.status === 400 ? err.message : OFFLINE_MESSAGE);
      }
    });
  };

  const switchMode = (next) => {
    setMode(next);
    setError(null);
    setCode('');
  };

  const emailField = (
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
  );
  const passwordField = (
    <FormField
      id="login-password"
      label="Password"
      type="password"
      autoComplete="current-password"
      value={password}
      onChange={(e) => setPassword(e.target.value)}
      required
    />
  );

  return (
    <div className="login">
      <div className="login__brand">
        <LisheLogo withTagline className="login__logo" />
      </div>

      <Card>
        {mode === 'password' ? (
          <div className="login__form">
            <div>
              <h1 className="login__title">Sign in</h1>
              <p className="login__intro">
                {user ? 'Sign in again to keep syncing. Records saved on this device are kept.' : 'Use the account your programme administrator gave you.'}
              </p>
            </div>

            {!isOnline && <Alert tone="neutral" title="You are offline">Signing in needs a connection.</Alert>}
            {error && <Alert tone="danger" title="Could not sign in">{error}</Alert>}
            {passkeyRequired && (
              <Alert tone="info" title="Use your passkey">
                This administrator account signs in with a passkey. Choose “Sign in with a passkey”, or use a recovery
                code if you cannot use any of your passkeys.
              </Alert>
            )}

            <form className="login__form" onSubmit={handlePassword}>
              {emailField}
              {passwordField}
              <Button type="submit" icon={LogIn} fullWidth loading={busy === 'password'} disabled={!isOnline || Boolean(busy)}>
                {busy === 'password' ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>

            {canUsePasskeys && (
              <>
                <p className="login__divider"><span>Administrators</span></p>
                <Button
                  variant={passkeyRequired ? 'primary' : 'secondary'}
                  icon={Fingerprint}
                  fullWidth
                  onClick={handlePasskey}
                  loading={busy === 'passkey'}
                  disabled={!isOnline || Boolean(busy)}
                >
                  Sign in with a passkey
                </Button>
                <Button variant="ghost" icon={LifeBuoy} fullWidth onClick={() => switchMode('recovery')}>
                  Can’t use your passkey?
                </Button>
              </>
            )}
          </div>
        ) : (
          <form className="login__form" onSubmit={handleRecovery}>
            <div>
              <h1 className="login__title">Use a recovery code</h1>
              <p className="login__intro">
                For administrators who cannot use any of their passkeys. Each code works once. If you have no codes
                left, ask another administrator to reset your passkeys.
              </p>
            </div>
            {!isOnline && <Alert tone="neutral" title="You are offline">Signing in needs a connection.</Alert>}
            {error && <Alert tone="danger" title="Could not sign in">{error}</Alert>}
            {emailField}
            {passwordField}
            <FormField
              id="login-recovery-code"
              label="Recovery code"
              hint="For example ABCDE-FGH23"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <Button type="submit" icon={LogIn} fullWidth loading={busy === 'recovery'} disabled={!isOnline || Boolean(busy)}>
              Sign in
            </Button>
            <Button variant="ghost" icon={ArrowLeft} fullWidth onClick={() => switchMode('password')}>
              Back to sign in
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}

export default Login;
