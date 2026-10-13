import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Fingerprint, KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { Alert, Button, Card, EmptyState, FormField, useToast } from '../../components/ui';
import { getPasskeys, regenerateRecoveryCodes, removePasskey } from '../../services/api';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { formatDate, formatRelativeTime } from '../../utils/format';
import { addPasskey, passkeyErrorMessage, passkeysSupported, suggestedPasskeyName } from './passkeyClient';

/**
 * Recovery codes, shown once. They let an administrator sign in with their password if
 * they cannot use any of their passkeys.
 */
function RecoveryCodes({ codes, onDone }) {
  const toast = useToast();
  const headingRef = useRef(null);
  useEffect(() => headingRef.current?.focus(), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast.show({ tone: 'success', title: 'Recovery codes copied' });
    } catch {
      toast.show({ tone: 'warning', title: 'Could not copy', description: 'Write the codes down instead.' });
    }
  };

  return (
    <div className="passkeys__codes">
      <h3 ref={headingRef} tabIndex={-1} className="passkeys__codes-title">Save your recovery codes</h3>
      <p>
        If you cannot use any of your passkeys, sign in with your password and one of these codes. Each code works
        once. Keep them somewhere safe, away from this device. <strong>They will not be shown again.</strong>
      </p>
      <ol className="passkeys__code-list" aria-label="Recovery codes">
        {codes.map((code) => <li key={code} className="passkeys__code tabular-nums">{code}</li>)}
      </ol>
      <div className="passkeys__actions">
        <Button variant="secondary" icon={Copy} onClick={copy}>Copy codes</Button>
        <Button onClick={onDone}>I have saved them</Button>
      </div>
    </div>
  );
}

/**
 * Settings → Passkeys, for administrators.
 */
function PasskeysCard() {
  const isOnline = useOnlineStatus();
  const toast = useToast();
  const supported = passkeysSupported();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState(() => suggestedPasskeyName());
  const [busy, setBusy] = useState(null); // 'add' | 'codes' | passkey id
  const [error, setError] = useState(null);
  const [codes, setCodes] = useState(null);
  const [confirmCodes, setConfirmCodes] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      setData(await getPasskeys());
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => {
    if (isOnline) load();
  }, [isOnline, load]);

  const add = async (event) => {
    event.preventDefault();
    setBusy('add');
    setError(null);
    try {
      const result = await addPasskey(name.trim() || suggestedPasskeyName());
      setAdding(false);
      toast.show({ tone: 'success', title: 'Passkey added', description: 'Next time, sign in with this passkey.' });
      if (result.recoveryCodes) setCodes(result.recoveryCodes);
      load();
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (passkey) => {
    setBusy(passkey.id);
    setError(null);
    try {
      await removePasskey(passkey.id);
      toast.show({ tone: 'success', title: `${passkey.name} removed` });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const newCodes = async () => {
    setBusy('codes');
    setError(null);
    try {
      setCodes((await regenerateRecoveryCodes()).recoveryCodes);
      setConfirmCodes(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const passkeys = data?.passkeys || [];

  return (
    <Card
      id="passkeys"
      title="Passkeys"
      description="Administrators sign in with a passkey: your device's fingerprint, face or screen lock. The private key never leaves the device. Add one on each device you use."
      actions={!adding && !codes && supported && (
        <Button icon={Fingerprint} onClick={() => setAdding(true)} disabled={!isOnline}>Add a passkey</Button>
      )}
    >
      <div className="ui-stack">
        {!supported && (
          <Alert tone="warning" title="This browser cannot use passkeys">
            Use an up-to-date Chrome, Edge, Safari or Firefox on a device with a screen lock.
          </Alert>
        )}
        {!isOnline && <Alert tone="neutral" title="You are offline">Managing passkeys needs a connection.</Alert>}
        {loadError && <Alert tone="danger" title="Passkeys could not be loaded">{loadError}</Alert>}
        {error && <Alert tone="danger" title="Not done">{error}</Alert>}

        {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}

        {adding && (
          <form className="passkeys__add" onSubmit={add} noValidate>
            <FormField
              label="Name for this passkey"
              hint="So you can tell your passkeys apart, e.g. Office laptop"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="passkeys__actions">
              <Button type="submit" icon={Fingerprint} loading={busy === 'add'}>Create passkey</Button>
              <Button variant="secondary" onClick={() => setAdding(false)} disabled={busy === 'add'}>Cancel</Button>
            </div>
          </form>
        )}

        {isOnline && data && passkeys.length === 0 && !adding && (
          <EmptyState
            compact
            icon={KeyRound}
            title="No passkey yet"
            description="Add a passkey to secure your administrator account. After that, signing in needs the passkey, not just your password."
          />
        )}

        {passkeys.length > 0 && (
          <ul className="passkeys__list">
            {passkeys.map((passkey) => (
              <li key={passkey.id} className="passkeys__item">
                <Fingerprint className="passkeys__item-icon" aria-hidden="true" />
                <div className="passkeys__item-text">
                  <p className="passkeys__item-name">{passkey.name}</p>
                  <p className="passkeys__item-meta">
                    Added {formatDate(passkey.createdAt)} · {passkey.lastUsedAt ? `last used ${formatRelativeTime(passkey.lastUsedAt)}` : 'not used yet'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  onClick={() => remove(passkey)}
                  loading={busy === passkey.id}
                  disabled={!isOnline || passkeys.length === 1 || Boolean(busy)}
                  aria-label={`Remove ${passkey.name}`}
                  title={passkeys.length === 1 ? 'You need at least one passkey' : undefined}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        {passkeys.length > 0 && !codes && (
          <div className="passkeys__recovery">
            <p className="passkeys__item-meta">
              {data.recoveryCodesLeft === 1 ? '1 recovery code left.' : `${data.recoveryCodesLeft} recovery codes left.`}
            </p>
            {confirmCodes ? (
              <Alert
                tone="warning"
                title="Get new recovery codes?"
                action={(
                  <div className="passkeys__actions">
                    <Button size="sm" onClick={newCodes} loading={busy === 'codes'}>Get new codes</Button>
                    <Button size="sm" variant="secondary" onClick={() => setConfirmCodes(false)}>Cancel</Button>
                  </div>
                )}
              >
                Your current recovery codes will stop working.
              </Alert>
            ) : (
              <Button variant="secondary" icon={RefreshCw} onClick={() => setConfirmCodes(true)} disabled={!isOnline || Boolean(busy)}>
                Get new recovery codes
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

export default PasskeysCard;
