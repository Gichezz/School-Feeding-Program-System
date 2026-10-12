import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Alert, Button, Card, FormField, useToast } from '../../components/ui';
import { changePassword } from '../../services/api';
import { saveSession } from '../../services/session';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { changePasswordErrors, MIN_PASSWORD_LENGTH } from './accountRules';

const EMPTY = { currentPassword: '', newPassword: '', confirmPassword: '' };

/**
 * Change your own password. The server returns a new session for this device and
 * ends every other session for the account.
 */
function ChangePasswordCard() {
  const isOnline = useOnlineStatus();
  const toast = useToast();
  const [values, setValues] = useState(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState(null);

  const errors = submitted ? changePasswordErrors(values) : {};
  const field = (name) => ({
    value: values[name],
    onChange: (e) => setValues((v) => ({ ...v, [name]: e.target.value })),
    error: errors[name],
  });

  const submit = async (event) => {
    event.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (Object.keys(changePasswordErrors(values)).length > 0) return;
    setSaving(true);
    try {
      const session = await changePassword(values.currentPassword, values.newPassword);
      saveSession(session);
      setValues(EMPTY);
      setSubmitted(false);
      toast.show({ tone: 'success', title: 'Password changed', description: 'You stay signed in here; other devices need to sign in again.' });
    } catch (err) {
      setServerError(err.message || 'The password could not be changed. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Change password" description="You need your current password. Other devices you are signed in on will need to sign in again.">
      <form className="settings__form" onSubmit={submit} noValidate>
        {!isOnline && <Alert tone="neutral" title="You are offline">Changing your password needs a connection.</Alert>}
        {serverError && <Alert tone="danger" title="Password not changed">{serverError}</Alert>}
        <FormField id="current-password" label="Current password" type="password" autoComplete="current-password" required {...field('currentPassword')} />
        <FormField
          id="new-password"
          label="New password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. A short phrase is easy to remember.`}
          required
          {...field('newPassword')}
        />
        <FormField id="confirm-password" label="Type the new password again" type="password" autoComplete="new-password" required {...field('confirmPassword')} />
        <div>
          <Button type="submit" icon={KeyRound} loading={saving} disabled={!isOnline}>Change password</Button>
        </div>
      </form>
    </Card>
  );
}

export default ChangePasswordCard;
