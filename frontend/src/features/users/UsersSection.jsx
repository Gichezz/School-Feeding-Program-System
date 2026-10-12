import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, Pencil, UserPlus, UserRoundCheck, UserRoundX } from 'lucide-react';
import { Alert, Badge, Button, Card, DataTable, FormField, useToast } from '../../components/ui';
import { createUser, getUsers, resetUserPassword, updateUser } from '../../services/api';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useSession } from '../../hooks/useSession';
import { formatDate } from '../../utils/format';
import { MIN_PASSWORD_LENGTH, newUserErrors, passwordError, ROLE_OPTIONS } from './accountRules';

const ROLE_LABEL = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]));
const EMPTY_USER = { name: '', email: '', role: 'school_staff', password: '' };
const PASSWORD_HINT = `At least ${MIN_PASSWORD_LENGTH} characters. Share it with them privately; they can change it in Settings.`;

/**
 * Add a user (name, email, role, initial password).
 */
function AddUserForm({ onDone, onCancel }) {
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
      const { user } = await createUser({ ...values, name: values.name.trim(), email: values.email.trim() });
      toast.show({ tone: 'success', title: `${user.name} added`, description: `They can sign in with ${user.email}.` });
      onDone();
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
        <FormField label="Initial password" type="password" autoComplete="new-password" hint={PASSWORD_HINT} required {...field('password')} />
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
function EditUserPanel({ user, isSelf, onDone, onCancel }) {
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role);
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(null); // 'save' | 'password' | 'status'
  const [confirmStatus, setConfirmStatus] = useState(false);
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
        </div>
        <div className="users__actions">
          <Button type="submit" icon={Pencil} loading={busy === 'save'} disabled={Boolean(busy)}>Save changes</Button>
          <Button variant="secondary" onClick={onCancel} disabled={Boolean(busy)}>Cancel</Button>
        </div>
      </form>

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
    if (isOnline) load();
  }, [isOnline, load]);

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
    { key: 'role', header: 'Role', render: (u) => ROLE_LABEL[u.role] || u.role },
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
      actions={panel === null && (
        <Button icon={UserPlus} onClick={() => setPanel('add')} disabled={!isOnline}>Add user</Button>
      )}
    >
      <div className="ui-stack">
        {!isOnline && <Alert tone="neutral" title="You are offline">Managing users needs a connection.</Alert>}
        {loadError && <Alert tone="danger" title="Users could not be loaded">{loadError}</Alert>}

        {panel === 'add' && <AddUserForm onDone={done} onCancel={() => setPanel(null)} />}
        {editing && <EditUserPanel key={editing.id} user={editing} isSelf={editing.id === me?.id} onDone={done} onCancel={() => setPanel(null)} />}

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
