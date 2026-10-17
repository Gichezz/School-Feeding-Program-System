import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Fingerprint, KeyRound, LifeBuoy, LogIn, Tablet } from 'lucide-react';
import { Alert, APP_NAME, Button, Card, FormField, useToast } from '../components/ui';
import LisheLogo from '../components/shell/LisheLogo';
import { login, signInWithRecoveryCode, signInWithTotp } from '../services/api';
import { saveSession } from '../services/session';
import { manualSync } from '../sync/syncManager';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useSession } from '../hooks/useSession';
import { passkeyErrorMessage, passkeysSupported, signInWithPasskey } from '../features/passkeys/passkeyClient';
import { getDeviceIdentity } from '../features/devices/deviceIdentity';
import { signInWithPin } from '../features/devices/deviceClient';
import { signInOffline } from '../features/devices/offlineSignIn';
import { isCompleteCode, normaliseCode } from '../features/totp/totpFormat';

const OFFLINE_MESSAGE = 'Could not reach the server. Try again when you are online.';

/**
 * Sign-in page. Needs a connection; records captured offline stay on the device
 * and sync after signing in. School staff sign in on a set-up school device with their
 * email and PIN (#60). Administrators sign in with a passkey (#57), or with their password
 * and a code from their authenticator app (#63); if they cannot use either, with their
 * password and a recovery code.
 */
function Login() {
  const navigate = useNavigate();
  const toast = useToast();
  const isOnline = useOnlineStatus();
  const { user } = useSession();
  const canUsePasskeys = passkeysSupported();
  const [mode, setMode] = useState(null); // 'device' | 'password' | 'totp' | 'recovery'
  const [identity, setIdentity] = useState(undefined);
  const [pin, setPin] = useState('');
  const [deviceRequired, setDeviceRequired] = useState(false);
  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [passkeyRequired, setPasskeyRequired] = useState(false);
  const [busy, setBusy] = useState(null); // 'device' | 'password' | 'passkey' | 'totp' | 'recovery'

  useEffect(() => {
    document.title = `Sign in · ${APP_NAME}`;
    // A set-up school device opens on staff PIN sign-in
    getDeviceIdentity().then((found) => {
      setIdentity(found);
      setMode(found ? 'device' : 'password');
    });
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
        // The password was right; the account also needs a code from its authenticator app
        if (err.data?.totpRequired) {
          setPasskeyRequired(Boolean(err.data.passkeyRequired));
          setCode('');
          setMode('totp');
          return;
        }
        if (err.data?.passkeyRequired) {
          setPasskeyRequired(true);
          return;
        }
        if (err.data?.deviceRequired) {
          setDeviceRequired(true);
          return;
        }
        setError(err.status === 401 || err.status === 400 ? err.message : OFFLINE_MESSAGE);
      }
    });
  };

  // Without a connection, the PIN is checked on this device instead (#61)
  const signInHereOffline = async () => {
    const session = await signInOffline(email.trim(), pin, identity.deviceId);
    toast.show({ tone: 'info', title: 'Signed in offline', description: 'Records you save sync when you are back online.' });
    finish(session);
  };

  const handleDevice = (event) => {
    event.preventDefault();
    return run('device', async () => {
      try {
        if (!isOnline) {
          await signInHereOffline();
          return;
        }
        try {
          finish(await signInWithPin(email.trim(), pin));
        } catch (err) {
          // The server could not be reached: fall back to offline sign-in on this device
          if (err.status) throw err;
          await signInHereOffline();
        }
      } catch (err) {
        setPin('');
        if (err.data?.deviceRevoked) setIdentity(null);
        setError(err.message || OFFLINE_MESSAGE);
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

  const handleTotp = (event) => {
    event.preventDefault();
    if (!isCompleteCode(code)) {
      setError('Enter the 6-digit code from your authenticator app');
      return undefined;
    }
    return run('totp', async () => {
      try {
        finish(await signInWithTotp(email.trim(), password, code));
      } catch (err) {
        setCode('');
        setError(err.status ? err.message : OFFLINE_MESSAGE);
      }
    });
  };

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
    setPin('');
  };

  if (mode === null) return null;

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
        {mode === 'device' && identity ? (
          <form className="login__form" onSubmit={handleDevice}>
            <div>
              <h1 className="login__title">Sign in</h1>
              <p className="login__intro">
                {identity.name}. Sign in with your email and the 6-digit PIN you set on this device.
              </p>
            </div>
            {!isOnline && (
              <Alert tone="neutral" title="You are offline">
                You can still sign in with your PIN if you have signed in online on this device in the last 7 days.
              </Alert>
            )}
            {identity.status !== 'approved' && !error && (
              <Alert tone="info" title="New device">
                An administrator approves each new device in Settings → School devices. Once they have, you can sign in here.
              </Alert>
            )}
            {error && <Alert tone="danger" title="Could not sign in">{error}</Alert>}
            {emailField}
            <FormField
              id="login-pin"
              label="PIN"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              size="lg"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
            />
            <Button type="submit" icon={LogIn} fullWidth loading={busy === 'device'} disabled={Boolean(busy)}>
              {busy === 'device' ? 'Signing in…' : isOnline ? 'Sign in' : 'Sign in offline'}
            </Button>
            <Button as={Link} to="/activate" variant="ghost" icon={KeyRound} fullWidth>
              New on this device, or forgot your PIN?
            </Button>
            <Button variant="ghost" icon={Fingerprint} fullWidth onClick={() => switchMode('password')}>
              Administrator sign-in
            </Button>
          </form>
        ) : mode === 'password' ? (
          <div className="login__form">
            <div>
              <h1 className="login__title">Sign in</h1>
              <p className="login__intro">
                {user ? 'Sign in again to keep syncing. Records saved on this device are kept.' : 'Use the account your programme administrator gave you.'}
              </p>
            </div>

            {!isOnline && <Alert tone="neutral" title="You are offline">Signing in needs a connection.</Alert>}
            {error && <Alert tone="danger" title="Could not sign in">{error}</Alert>}
            {deviceRequired && (
              <Alert
                tone="info"
                title="Sign in on your school device"
                action={identity
                  ? <Button size="sm" variant="secondary" onClick={() => switchMode('device')}>Use PIN sign-in</Button>
                  : <Button as={Link} to="/activate" size="sm" variant="secondary">Set up this device</Button>}
              >
                School staff sign in on the school's device with their email and PIN.
                {!identity && ' If this is the school device, set it up first.'}
              </Alert>
            )}
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
                  Can’t use your passkey or app?
                </Button>
              </>
            )}

            <p className="login__divider"><span>School staff</span></p>
            {identity ? (
              <Button variant="secondary" icon={Tablet} fullWidth onClick={() => switchMode('device')}>Sign in with your PIN</Button>
            ) : (
              <Button as={Link} to="/activate" variant="secondary" icon={Tablet} fullWidth>Set up this school device</Button>
            )}
          </div>
        ) : mode === 'totp' ? (
          <form className="login__form" onSubmit={handleTotp} noValidate>
            <div>
              <h1 className="login__title">Enter your code</h1>
              <p className="login__intro">
                Open your authenticator app and enter the 6-digit code it shows for Lishe ({email.trim()}).
              </p>
            </div>
            {!isOnline && <Alert tone="neutral" title="You are offline">Signing in needs a connection.</Alert>}
            {error && <Alert tone="danger" title="Could not sign in">{error}</Alert>}
            <FormField
              id="login-totp-code"
              label="Code"
              inputMode="numeric"
              autoComplete="one-time-code"
              size="lg"
              autoFocus
              value={code}
              onChange={(e) => setCode(normaliseCode(e.target.value))}
              required
            />
            <Button type="submit" icon={LogIn} fullWidth loading={busy === 'totp'} disabled={!isOnline || Boolean(busy)}>
              Sign in
            </Button>
            {passkeyRequired && canUsePasskeys && (
              <Button variant="secondary" icon={Fingerprint} fullWidth onClick={handlePasskey} loading={busy === 'passkey'} disabled={!isOnline || Boolean(busy)}>
                Use a passkey instead
              </Button>
            )}
            <Button variant="ghost" icon={LifeBuoy} fullWidth onClick={() => switchMode('recovery')}>
              Can’t use your app? Use a recovery code
            </Button>
            <Button variant="ghost" icon={ArrowLeft} fullWidth onClick={() => switchMode('password')}>
              Back to sign in
            </Button>
          </form>
        ) : (
          <form className="login__form" onSubmit={handleRecovery}>
            <div>
              <h1 className="login__title">Use a recovery code</h1>
              <p className="login__intro">
                For administrators who cannot use their passkeys or authenticator app. Each code works once. If you
                have no codes left, ask another administrator to reset your passkeys and app.
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
