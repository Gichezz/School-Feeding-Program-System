import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Smartphone, Trash2 } from 'lucide-react';
import { Alert, Button, Card, FormField, LoadingRegion, SkeletonText, useToast } from '../../components/ui';
import { confirmTotpSetup, getTotpStatus, removeTotp, startTotpSetup } from '../../services/api';
import { getSession, saveSession } from '../../services/session';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { formatDate } from '../../utils/format';
import { RecoveryCodes } from '../passkeys/PasskeysCard';
import { formatSecret, isCompleteCode, normaliseCode, SECOND_FACTOR_CHANGED_EVENT } from './totpFormat';

/**
 * Settings → Authenticator app (#63), for administrators whose computer or phone cannot
 * hold a passkey. Scan the QR code with an app such as Google Authenticator or
 * Microsoft Authenticator and confirm one code; after that, signing in with a password
 * also needs a code from the app. Codes are checked by the server, so this needs a
 * connection.
 */
function AuthenticatorCard() {
  const isOnline = useOnlineStatus();
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(null); // 'setup' | 'confirm' | 'remove'
  const [error, setError] = useState(null);
  const setupHeadingRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      setStatus(await getTotpStatus());
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => {
    if (isOnline) load();
  }, [isOnline, load]);

  useEffect(() => {
    if (setup) setupHeadingRef.current?.focus();
  }, [setup]);

  const run = async (kind, action) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const begin = () => run('setup', async () => {
    setSetup(await startTotpSetup());
    setCode('');
  });

  const confirm = (event) => {
    event.preventDefault();
    if (!isCompleteCode(code)) {
      setError('Enter the 6-digit code shown in your authenticator app');
      return undefined;
    }
    return run('confirm', async () => {
      const result = await confirmTotpSetup(code);
      setSetup(null);
      if (result.recoveryCodes) setCodes(result.recoveryCodes);
      // The account now has a second step, so stop asking for a passkey
      const session = getSession();
      if (session?.user?.needsPasskey) saveSession({ ...session, user: { ...session.user, needsPasskey: false } });
      window.dispatchEvent(new Event(SECOND_FACTOR_CHANGED_EVENT));
      toast.show({ tone: 'success', title: 'Authenticator app set up', description: 'Next time you sign in with your password, enter a code from the app.' });
      load();
    });
  };

  const remove = () => run('remove', async () => {
    await removeTotp();
    setConfirmRemove(false);
    window.dispatchEvent(new Event(SECOND_FACTOR_CHANGED_EVENT));
    toast.show({ tone: 'success', title: 'Authenticator app removed' });
    load();
  });

  return (
    <Card
      id="authenticator"
      title="Authenticator app"
      description="A second option if this computer or phone cannot hold a passkey: sign in with your password and a 6-digit code from an app such as Google Authenticator."
      actions={status && !status.enabled && !setup && !codes && (
        <Button icon={Smartphone} onClick={begin} loading={busy === 'setup'} disabled={!isOnline || Boolean(busy)}>
          Set up an app
        </Button>
      )}
    >
      <div className="ui-stack">
        {!isOnline && <Alert tone="neutral" title="You are offline">Setting up an authenticator app needs a connection.</Alert>}
        {loadError && <Alert tone="danger" title="Could not load">{loadError}</Alert>}
        {error && <Alert tone="danger" title="Not done">{error}</Alert>}
        {isOnline && !status && !loadError && <LoadingRegion label="Loading"><SkeletonText lines={2} /></LoadingRegion>}

        {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}

        {setup && (
          <form className="totp__setup" onSubmit={confirm} noValidate>
            <h3 ref={setupHeadingRef} tabIndex={-1} className="totp__title">Scan this code with your authenticator app</h3>
            <div className="totp__qr-row">
              <img className="totp__qr" src={setup.qrCode} alt="QR code to add Lishe to your authenticator app" width="200" height="200" />
              <div className="totp__manual">
                <p>Cannot scan it? Choose “enter a setup key” in the app and type:</p>
                <p className="totp__secret tabular-nums">{formatSecret(setup.secret)}</p>
                <p className="totp__hint">Time-based, 6 digits. Keep this key private.</p>
              </div>
            </div>
            <FormField
              id="totp-confirm-code"
              label="Code from the app"
              hint="Enter the 6-digit code the app now shows for Lishe"
              inputMode="numeric"
              autoComplete="one-time-code"
              size="lg"
              value={code}
              onChange={(e) => setCode(normaliseCode(e.target.value))}
              required
            />
            <div className="passkeys__actions">
              <Button type="submit" icon={CheckCircle2} loading={busy === 'confirm'} disabled={!isOnline}>Confirm and turn on</Button>
              <Button variant="secondary" onClick={() => { setSetup(null); setError(null); }} disabled={busy === 'confirm'}>Cancel</Button>
            </div>
          </form>
        )}

        {status?.enabled && !codes && (
          <div className="passkeys__item">
            <Smartphone className="passkeys__item-icon" aria-hidden="true" />
            <div className="passkeys__item-text">
              <p className="passkeys__item-name">Authenticator app is on</p>
              <p className="passkeys__item-meta">Set up {formatDate(status.confirmedAt)}. Your recovery codes work for it too.</p>
            </div>
            {!confirmRemove && (
              <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setConfirmRemove(true)} disabled={!isOnline || Boolean(busy)}>
                Remove
              </Button>
            )}
          </div>
        )}
        {confirmRemove && (
          <Alert
            tone="warning"
            title="Remove the authenticator app?"
            action={(
              <div className="passkeys__actions">
                <Button variant="danger" size="sm" onClick={remove} loading={busy === 'remove'}>Remove</Button>
                <Button variant="secondary" size="sm" onClick={() => setConfirmRemove(false)} disabled={Boolean(busy)}>Cancel</Button>
              </div>
            )}
          >
            Codes from the app will stop working. You need a passkey to sign in after this.
          </Alert>
        )}
        {status && !status.enabled && !setup && !codes && (
          <p className="passkeys__item-meta">Not set up. Passkeys are the main way to sign in; use this if you cannot use one.</p>
        )}
      </div>
    </Card>
  );
}

export default AuthenticatorCard;
