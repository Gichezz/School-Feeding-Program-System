import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Fingerprint, KeyRound, Pencil, Ticket, UserPlus, UserRoundCheck, UserRoundX } from 'lucide-react';
import { Alert, Badge, Button, Card, DataTable, FormField, useToast } from '../../components/ui';
import { createUser, getSchools, getUsers, newActivationCode, resetUserPasskeys, resetUserPassword, updateUser } from '../../services/api';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useSession } from '../../hooks/useSession';
import { formatDate, formatDateTime } from '../../utils/format';
import { MIN_PASSWORD_LENGTH, newUserErrors, passwordError, ROLE_OPTIONS } from './accountRules';

const ROLE_LABEL = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]));
const EMPTY_USER = { name: '', email: '', role: 'school_staff', password: '', schoolId: '' };
const PASSWORD_HINT = `At least ${MIN_PASSWORD_LENGTH} characters. Share it with them privately; they can change it in Settings.`;

/**
 * A one-time activation code for a staff member, shown once (#60). They use it on the
 * school device, with their email, to choose their password and PIN.
 */
function ActivationCode({ name, code, expiresAt, onDone }) {
  const toast = useToast();
  const headingRef = useRef(null);
  useEffect(() => headingRef.current?.focus(), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.show({ tone: 'success', title: 'Activation code copied' });
    } catch {
      toast.show({ tone: 'warning', title: 'Could not copy', description: 'Write the code down instead.' });
    }
  };

  return (
    <div className="users__code">
      <h3 ref={headingRef} tabIndex={-1} className="users__panel-title">Activation code for {name}</h3>
      <p className="users__code-value tabular-nums">{code}</p>
      <p>
        Give this code to {name} privately. On the school device they choose <strong>Set up this school device</strong>,
        enter their email and this code, and pick their own password and PIN. It works once and expires {formatDateTime(expiresAt)}.
        It will not be shown again; you can issue a new one from Manage.
      </p>
      <div className="users__actions">
        <Button variant="secondary" icon={Copy} onClick={copy}>Copy code</Button>
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

const schoolOptions = (schools) => [
  { value: '', label: 'Choose a school', disabled: true },
  ...schools.map((school) => ({ value: school.id, label: school.name })),
];

/**
 * Add a user. Administrators get an initial password; school staff get a school and a
 * one-time activation code instead (they set their own password and PIN on the device).
 */
function AddUserForm({ schools, onDone, onCancel, onCode }) {
  const toast = useToast();
  const [values, setValues] = useState(EMPTY_USER);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState(null);
  const headingRef = useRef(null);

  useEffect(() => headingRef.current?.focus(), []);

  const errors = submitted ? newUserErrors(values) : {};
  const field = (name) => ({
    value: values[name],
    onChange: (e) => setValues((v) => ({ ...v, [name]: e.target.value })),
    error: errors[name],
  });

  const submit = async (event) => {
    event.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (Object.keys(newUserErrors(values)).length > 0) return;
    setSaving(true);
    try {
      const isStaff = values.role === 'school_staff';
      const result = await createUser({
        name: values.name.trim(),
        email: values.email.trim(),
        role: values.role,
        ...(isStaff ? { schoolId: values.schoolId } : { password: values.password }),
      });
      toast.show({ tone: 'success', title: `${result.user.name} added` });
      if (result.activationCode) {
        onCode({ name: result.user.name, code: result.activationCode, expiresAt: result.activationExpiresAt });
      } else {
        onDone();
      }
    } catch (err) {
      setServerError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="users__panel" onSubmit={submit} noValidate>
      <h3 ref={headingRef} tabIndex={-1} className="users__panel-title">Add a user</h3>
      {serverError && <Alert tone="danger" title="User not added">{serverError}</Alert>}
      <div className="ui-grid ui-grid--2">
        <FormField label="Name" autoComplete="off" required {...field('name')} />
        <FormField label="Email" type="email" inputMode="email" autoComplete="off" required {...field('email')} />
        <FormField label="Role" as="select" options={ROLE_OPTIONS} {...field('role')} />
        {values.role === 'school_staff' ? (
          <FormField label="School" as="select" options={schoolOptions(schools)} hint="They can only record for this school" required {...field('schoolId')} />
        ) : (
          <FormField label="Initial password" type="password" autoComplete="new-password" hint={PASSWORD_HINT} required {...field('password')} />
        )}
      </div>
      <div className="users__actions">
        <Button type="submit" icon={UserPlus} loading={saving}>Add user</Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>
    </form>
  );
}

/**
 * Change a user's name or role, reset their password, or deactivate / reactivate them.
 */
function EditUserPanel({ user, isSelf, schools, onDone, onCancel, onCode }) {
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role);
  const [schoolId, setSchoolId] = useState(user.schoolId || '');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(null); // 'save' | 'password' | 'status' | 'passkeys'
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [confirmPasskeys, setConfirmPasskeys] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const headingRef = useRef(null);

  useEffect(() => headingRef.current?.focus(), []);

  const run = async (kind, action, message) => {
    setBusy(kind);
    setServerError(null);
    try {
      await action();
      toast.show({ tone: 'success', ...message });
      onDone();
    } catch (err) {
      setServerError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const save = (event) => {
    event.preventDefault();
    if (!name.trim()) return setErrors({ name: 'Enter their name' });
    setErrors({});
    const changes = {};
    if (name.trim() !== user.name) changes.name = name.trim();
    if (role !== user.role) changes.role = role;
    if (role === 'school_staff' && !schoolId) return setErrors({ schoolId: 'Choose their school' });
    if (role === 'school_staff' && schoolId !== (user.schoolId || '')) changes.schoolId = schoolId;
    if (Object.keys(changes).length === 0) return onCancel();
    return run('save', () => updateUser(user.id, changes), { title: 'Changes saved', description: changes.role ? `${name.trim()} is now ${ROLE_LABEL[role].toLowerCase()}.` : undefined });
  };

  const reset = () => {
    const weak = passwordError(newPassword);
    if (weak) return setErrors({ newPassword: weak });
    setErrors({});
    return run('password', () => resetUserPassword(user.id, newPassword), {
      title: 'Password reset',
      description: `${user.name} has been signed out everywhere and can sign in with the new password.`,
    });
  };

  const toggleStatus = () => run('status', () => updateUser(user.id, { isActive: !user.isActive }), {
    title: user.isActive ? `${user.name} deactivated` : `${user.name} reactivated`,
    description: user.isActive ? 'They can no longer sign in, and their sessions have ended.' : 'They can sign in again.',
  });

  const issueCode = async () => {
    setBusy('code');
    setServerError(null);
    try {
      const { activationCode, expiresAt } = await newActivationCode(user.id);
      onCode({ name: user.name, code: activationCode, expiresAt });
    } catch (err) {
      setServerError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const resetPasskeys = () => run('passkeys', () => resetUserPasskeys(user.id), {
    title: `${user.name}'s passkeys and authenticator app reset`,
    description: 'They have been signed out everywhere. They sign in with their password and set up a passkey or app again.',
  });

  return (
    <div className="users__panel">
      <h3 ref={headingRef} tabIndex={-1} className="users__panel-title">{user.name}</h3>
      <p className="users__panel-meta">{user.email}</p>
      {serverError && <Alert tone="danger" title="Not changed">{serverError}</Alert>}

      <form className="users__form" onSubmit={save} noValidate>
        <div className="ui-grid ui-grid--2">
          <FormField label="Name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} required />
          <FormField
            label="Role"
            as="select"
            options={ROLE_OPTIONS}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={isSelf}
            hint={isSelf ? 'You cannot change your own role. Ask another administrator.' : undefined}
          />
          {role === 'school_staff' && (
            <FormField
              label="School"
              as="select"
              options={schoolOptions(schools)}
              value={schoolId}
              onChange={(e) => setSchoolId(e.target.value)}
              error={errors.schoolId}
              hint="They can only record for this school"
              required
            />
          )}
        </div>
        <div className="users__actions">
          <Button type="submit" icon={Pencil} loading={busy === 'save'} disabled={Boolean(busy)}>Save changes</Button>
          <Button variant="secondary" onClick={onCancel} disabled={Boolean(busy)}>Cancel</Button>
        </div>
      </form>

      {user.role === 'school_staff' && user.isActive && (
        <div className="users__section">
          <h4 className="users__section-title">Activation code</h4>
          <p className="users__panel-meta">
            For setting up a school device for the first time, or after forgetting their password. Any earlier code stops working.
          </p>
          <div>
            <Button variant="secondary" icon={Ticket} onClick={issueCode} loading={busy === 'code'} disabled={Boolean(busy)}>
              Issue a new activation code
            </Button>
          </div>
        </div>
      )}

      <div className="users__section">
        <h4 className="users__section-title">Reset password</h4>
        <div className="users__inline">
          <FormField
            label="New password"
            type="password"
            autoComplete="new-password"
            hint={isSelf ? 'To change your own password, use Change password above.' : PASSWORD_HINT}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            error={errors.newPassword}
            disabled={isSelf}
          />
          <Button variant="secondary" icon={KeyRound} onClick={reset} loading={busy === 'password'} disabled={Boolean(busy) || isSelf}>
            Reset password
          </Button>
        </div>
      </div>

      {!isSelf && (user.passkeyCount > 0 || user.totpEnabled) && (
        <div className="users__section">
          <h4 className="users__section-title">Passkeys and authenticator app</h4>
          {confirmPasskeys ? (
            <Alert
              tone="warning"
              title={`Reset ${user.name}'s passkeys and authenticator app?`}
              action={(
                <div className="users__actions users__actions--tight">
                  <Button variant="danger" size="sm" onClick={resetPasskeys} loading={busy === 'passkeys'}>Reset passkeys and app</Button>
                  <Button variant="secondary" size="sm" onClick={() => setConfirmPasskeys(false)} disabled={Boolean(busy)}>Cancel</Button>
                </div>
              )}
            >
              Use this if they lost the device with their passkey or authenticator app and have no recovery codes.
              Their passkeys, authenticator app and recovery codes are removed and they are signed out everywhere.
              They then sign in with their password and set up a passkey or app again.
            </Alert>
          ) : (
            <Button variant="secondary" icon={Fingerprint} onClick={() => setConfirmPasskeys(true)} disabled={Boolean(busy)}>
              Reset passkeys and app
            </Button>
          )}
        </div>
      )}

      {!isSelf && (
        <div className="users__section">
          <h4 className="users__section-title">{user.isActive ? 'Deactivate' : 'Reactivate'}</h4>
          {user.isActive && confirmStatus ? (
            <Alert
              tone="warning"
              title={`Deactivate ${user.name}?`}
              action={(
                <div className="users__actions users__actions--tight">
                  <Button variant="danger" size="sm" onClick={toggleStatus} loading={busy === 'status'}>Deactivate</Button>
                  <Button variant="secondary" size="sm" onClick={() => setConfirmStatus(false)} disabled={Boolean(busy)}>Cancel</Button>
                </div>
              )}
            >
              They will be signed out everywhere and cannot sign in. Records they saved are kept, and you can reactivate them later.
            </Alert>
          ) : (
            <Button
              variant={user.isActive ? 'secondary' : 'primary'}
              icon={user.isActive ? UserRoundX : UserRoundCheck}
              onClick={user.isActive ? () => setConfirmStatus(true) : toggleStatus}
              loading={busy === 'status'}
              disabled={Boolean(busy)}
            >
              {user.isActive ? 'Deactivate user' : 'Reactivate user'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Users section of Settings, for administrators. Needs a connection.
 */
function UsersSection() {
  const isOnline = useOnlineStatus();
  const { user: me } = useSession();
  const [users, setUsers] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [panel, setPanel] = useState(null); // null | 'add' | user id
  const [schools, setSchools] = useState([]);
  const [activation, setActivation] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      setUsers((await getUsers()).users || []);
    } catch (err) {
      setUsers([]);
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => {
    if (!isOnline) return;
    load();
    getSchools().then((res) => setSchools(res.schools || [])).catch(() => setSchools([]));
  }, [isOnline, load]);

  const showCode = (details) => {
    setPanel(null);
    setActivation(details);
    load();
  };

  const done = () => {
    setPanel(null);
    load();
  };

  const columns = [
    {
      key: 'name',
      header: 'Name',
      primary: true,
      render: (u) => (
        <span className="users__name">
          {u.name}
          {u.id === me?.id && <Badge tone="brand">You</Badge>}
        </span>
      ),
    },
    { key: 'email', header: 'Email' },
    { key: 'school', header: 'School', render: (u) => u.schoolName || (u.role === 'admin' ? 'All schools' : '–') },
    { key: 'role', header: 'Role', render: (u) => ROLE_LABEL[u.role] || u.role },
    {
      key: 'passkey',
      header: 'Second step',
      render: (u) => {
        if (u.role !== 'admin') return '–';
        if (!u.passkeyCount && !u.totpEnabled) return <Badge tone="warning">Not set up</Badge>;
        const parts = [
          ...(u.passkeyCount ? [u.passkeyCount === 1 ? '1 passkey' : `${u.passkeyCount} passkeys`] : []),
          ...(u.totpEnabled ? ['app'] : []),
        ];
        return <Badge tone="success">{parts.join(' + ')}</Badge>;
      },
    },
    { key: 'status', header: 'Status', render: (u) => (u.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Deactivated</Badge>) },
    { key: 'added', header: 'Added', render: (u) => formatDate(u.createdAt) },
    {
      key: 'actions',
      header: <span className="visually-hidden">Actions</span>,
      render: (u) => (
        <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setPanel(u.id)} aria-label={`Manage ${u.name}`}>
          Manage
        </Button>
      ),
    },
  ];

  const editing = users?.find((u) => u.id === panel);

  return (
    <Card
      title="Users"
      description="Everyone who can sign in to Lishe. Only administrators see this section."
      actions={panel === null && !activation && (
        <Button icon={UserPlus} onClick={() => setPanel('add')} disabled={!isOnline}>Add user</Button>
      )}
    >
      <div className="ui-stack">
        {!isOnline && <Alert tone="neutral" title="You are offline">Managing users needs a connection.</Alert>}
        {loadError && <Alert tone="danger" title="Users could not be loaded">{loadError}</Alert>}

        {activation && <ActivationCode {...activation} onDone={() => setActivation(null)} />}
        {panel === 'add' && <AddUserForm schools={schools} onDone={done} onCancel={() => setPanel(null)} onCode={showCode} />}
        {editing && (
          <EditUserPanel
            key={editing.id}
            user={editing}
            isSelf={editing.id === me?.id}
            schools={schools}
            onDone={done}
            onCancel={() => setPanel(null)}
            onCode={showCode}
          />
        )}

        {isOnline && (
          <DataTable
            caption="Users"
            columns={columns}
            rows={users || []}
            loading={users === null}
            emptyState={{ title: 'No users yet' }}
          />
        )}
      </div>
    </Card>
  );
}

export default UsersSection;
