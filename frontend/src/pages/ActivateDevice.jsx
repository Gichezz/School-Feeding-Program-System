import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Clock, LogIn, Tablet } from 'lucide-react';
import { Alert, APP_NAME, Button, Card, FormField } from '../components/ui';
import DeviceSteps from '../features/devices/DeviceSteps';
import LisheLogo from '../components/shell/LisheLogo';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { deviceSetupErrors, MIN_PASSWORD_LENGTH } from '../features/users/accountRules';
import { getDeviceIdentity } from '../features/devices/deviceIdentity';
import { setUpDevice } from '../features/devices/deviceClient';
import { useDeviceApproval } from '../features/devices/useDeviceApproval';

const EMPTY = {
  email: '',
  method: 'code',
  activationCode: '',
  newPassword: '',
  confirmPassword: '',
  password: '',
  pin: '',
  confirmPin: '',
  deviceName: '',
};

/**
 * Set up staff sign-in on a designated school device (#60). A new staff member uses the
 * activation code from their administrator; someone who already has a password (or
 * forgot their PIN) uses their password. A new device waits for an administrator to
 * approve it.
 */
function ActivateDevice() {
  const isOnline = useOnlineStatus();
  const [identity, setIdentity] = useState(undefined);
  const [values, setValues] = useState(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  // After set-up, the screen changes by itself once the device is approved
  const waiting = useMemo(() => (result ? { status: result.device.status } : null), [result]);
  const approval = useDeviceApproval(waiting);
  const resultRef = useRef(null);

  useEffect(() => {
    document.title = `Set up this school device · ${APP_NAME}`;
    getDeviceIdentity().then(setIdentity);
  }, []);

  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

  const needsDeviceName = identity === null;
  const errors = submitted ? deviceSetupErrors({ ...values, needsDeviceName }) : {};
  const field = (name) => ({
    value: values[name],
    onChange: (e) => setValues((v) => ({ ...v, [name]: e.target.value })),
    error: errors[name],
  });
  const pinField = (name) => ({
    ...field(name),
    type: 'password',
    inputMode: 'numeric',
    autoComplete: 'off',
    maxLength: 6,
  });

  const submit = async (event) => {
    event.preventDefault();
    setSubmitted(true);
    setError(null);
    if (Object.keys(deviceSetupErrors({ ...values, needsDeviceName })).length > 0) return;
    setSaving(true);
    try {
      const credentials = values.method === 'code'
        ? { activationCode: values.activationCode.trim(), newPassword: values.newPassword }
        : { password: values.password };
      const response = await setUpDevice({ email: values.email.trim(), pin: values.pin, ...credentials }, values.deviceName.trim());
      setResult(response);
    } catch (err) {
      setError(err.status ? err.message : 'Could not reach the server. Setting up a device needs a connection.');
      setIdentity(await getDeviceIdentity());
    } finally {
      setSaving(false);
    }
  };

  if (identity === undefined) return null;

  if (result && approval === 'expired') {
    return (
      <div className="login">
        <div className="login__brand"><LisheLogo withTagline className="login__logo" /></div>
        <Card>
          <div className="login__form">
            <h1 ref={resultRef} tabIndex={-1} className="login__title">This set-up has expired</h1>
            <p className="login__intro">{result.device.name} was not approved in time. Set it up again; it then waits for approval as a new device.</p>
            <Button onClick={() => { setResult(null); setIdentity(null); }} fullWidth>Set up again</Button>
          </div>
        </Card>
      </div>
    );
  }

  if (result) {
    const approved = approval === 'approved';
    return (
      <div className="login">
        <div className="login__brand"><LisheLogo withTagline className="login__logo" /></div>
        <Card>
          <div className="login__form">
            <div className="activate__result">
              {approved
                ? <CheckCircle2 className="activate__result-icon activate__result-icon--done" aria-hidden="true" />
                : <Clock className="activate__result-icon" aria-hidden="true" />}
              <h1 ref={resultRef} tabIndex={-1} className="login__title">
                {approved ? 'You are set up' : 'Waiting for approval'}
              </h1>
            </div>
            <DeviceSteps status={approved ? 'approved' : 'pending'} />
            <p className="login__intro">
              {approved
                ? `${result.user.name}, you can now sign in on ${result.device.name} with your email and PIN.`
                : `${result.device.name} is set up. You can sign in with your email and PIN once it is approved. This page will tell you.`}
            </p>
            <Button as={Link} to="/login" icon={LogIn} fullWidth>Go to sign in</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="login">
      <div className="login__brand"><LisheLogo withTagline className="login__logo" /></div>
      <Card>
        <form className="login__form" onSubmit={submit} noValidate>
          <div>
            <h1 className="login__title">Set up this school device</h1>
            <p className="login__intro">
              For feeding teachers, on the school's tablet or phone. You choose a PIN to sign in with here.
            </p>
          </div>
          {!identity && <DeviceSteps status={null} />}

          {identity && (
            <Alert tone="neutral" icon={Tablet} title={`This is ${identity.name}`}>
              {identity.status === 'approved'
                ? 'This device is already set up. Add yourself to it, or set a new PIN if you forgot yours.'
                : 'This device is waiting for approval. You can still add yourself to it.'}
            </Alert>
          )}
          {!isOnline && <Alert tone="neutral" title="You are offline">Setting up a device needs a connection.</Alert>}
          {error && <Alert tone="danger" title="Not set up">{error}</Alert>}

          <FormField id="activate-email" label="Email" type="email" inputMode="email" autoComplete="username" required {...field('email')} />

          <div className="activate__method">
            <span id="activate-method" className="ui-date-range__label">How are you setting up?</span>
            <div className="ui-segmented" role="group" aria-labelledby="activate-method">
              <button type="button" className="ui-segmented__option" aria-pressed={values.method === 'code'} onClick={() => setValues((v) => ({ ...v, method: 'code' }))}>
                Activation code
              </button>
              <button type="button" className="ui-segmented__option" aria-pressed={values.method === 'password'} onClick={() => setValues((v) => ({ ...v, method: 'password' }))}>
                I have a password
              </button>
            </div>
          </div>

          {values.method === 'code' ? (
            <>
              <FormField
                id="activate-code"
                label="Activation code"
                hint="The code you were given, e.g. ABCD-EFGH-JKLM. It works once, within 48 hours."
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellCheck={false}
                required
                {...field('activationCode')}
              />
              <FormField id="activate-new-password" label="Choose a password" type="password" autoComplete="new-password"
                hint={`At least ${MIN_PASSWORD_LENGTH} characters. You need it to set up a device again.`} required {...field('newPassword')} />
              <FormField id="activate-confirm-password" label="Type the password again" type="password" autoComplete="new-password" required {...field('confirmPassword')} />
            </>
          ) : (
            <FormField id="activate-password" label="Password" type="password" autoComplete="current-password" required {...field('password')} />
          )}

          <FormField id="activate-pin" label="Choose a 6-digit PIN" hint="Avoid easy ones like 123456 or 000000." size="lg" required {...pinField('pin')} />
          <FormField id="activate-confirm-pin" label="Type the PIN again" size="lg" required {...pinField('confirmPin')} />

          {needsDeviceName && (
            <FormField id="activate-device-name" label="Name for this device" hint="For example, Kitchen tablet" maxLength={60} required {...field('deviceName')} />
          )}

          <Button type="submit" icon={Tablet} fullWidth loading={saving} disabled={!isOnline}>Set up this device</Button>
          <Button as={Link} to="/login" variant="ghost" icon={ArrowLeft} fullWidth>Back to sign in</Button>
        </form>
      </Card>
    </div>
  );
}

export default ActivateDevice;
