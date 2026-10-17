const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const { api, USERS } = require('./helpers/auth');
const { pool, MISSING_ID, SCHOOL_ID, resetDatabase } = require('./helpers/fixtures');

beforeEach(resetDatabase);
afterAll(() => pool.end());

const asAdmin = api(app, 'admin');
const asStaff = api(app, 'staff');

function login(email, password) {
  return request(app).post('/api/auth/login').send({ email, password });
}

/**
 * School staff no longer sign in with a password alone (#60), so their password is
 * checked against the stored hash instead.
 */
async function passwordIs(email, password) {
  const row = await pool.query('SELECT password_hash FROM users WHERE lower(email) = lower($1)', [email]);
  return bcrypt.compare(password, row.rows[0].password_hash);
}

function newUser(overrides = {}) {
  return { name: 'Grace Achieng', email: 'Grace@Example.org', role: 'admin', password: 'kitchen-ledger-42', ...overrides };
}

function newStaff(overrides = {}) {
  return { name: 'Peter Otieno', email: 'Peter@Example.org', role: 'school_staff', schoolId: SCHOOL_ID, ...overrides };
}

async function createUser(overrides) {
  const res = await asAdmin.post('/api/users').send(newUser(overrides));
  return res.body.user;
}

describe('account management is admin-only', () => {
  it.each([
    ['list users', (a) => a.get('/api/users')],
    ['add a user', (a) => a.post('/api/users').send(newUser())],
    ['change a user', (a) => a.patch(`/api/users/${USERS.admin.id}`).send({ role: 'school_staff' })],
    ['reset a password', (a) => a.post(`/api/users/${USERS.admin.id}/password`).send({ password: 'another-long-one' })],
  ])('school staff cannot %s (403)', async (_, call) => {
    const res = await call(asStaff);

    expect(res.status).toBe(403);
  });

  it('requires sign-in (401)', async () => {
    const res = await request(app).get('/api/users');

    expect(res.status).toBe(401);
  });
});

describe('GET /api/users', () => {
  it('lists users without any password data', async () => {
    const res = await asAdmin.get('/api/users');

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(2);
    expect(res.body.users[0]).toEqual({
      id: expect.any(String), name: expect.any(String), email: expect.any(String), role: expect.any(String),
      isActive: true, createdAt: expect.any(String), updatedAt: expect.any(String), passkeyCount: 0, totpEnabled: false,
      schoolId: null, schoolName: null,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password|\$2[aby]\$/i);
  });
});

describe('POST /api/users', () => {
  it('adds an administrator who can then sign in, storing the email in lower case and only a bcrypt hash', async () => {
    const res = await asAdmin.post('/api/users').send(newUser());

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Grace Achieng', email: 'grace@example.org', role: 'admin', schoolId: null, isActive: true });
    expect(res.body).not.toHaveProperty('activationCode');
    const row = await pool.query('SELECT password_hash FROM users WHERE email = $1', ['grace@example.org']);
    expect(row.rows[0].password_hash).toMatch(/^\$2[aby]\$10\$/);
    expect((await login('grace@example.org', 'kitchen-ledger-42')).status).toBe(200);
  });

  it('adds a school staff member at a school with a one-time activation code instead of a password', async () => {
    const res = await asAdmin.post('/api/users').send(newStaff());

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'peter@example.org', role: 'school_staff', schoolId: SCHOOL_ID });
    expect(res.body.activationCode).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const hours = (new Date(res.body.activationExpiresAt) - Date.now()) / 3600000;
    expect(hours).toBeGreaterThan(47.9);
    expect(hours).toBeLessThanOrEqual(48);
    const code = await pool.query('SELECT code_hash, used_at FROM activation_codes WHERE user_id = $1', [res.body.user.id]);
    expect(code.rows).toEqual([{ code_hash: expect.stringMatching(/^\$2[aby]\$10\$/), used_at: null }]);
  });

  it.each([
    ['without a school', { schoolId: undefined }],
    ['at a school that does not exist', { schoolId: MISSING_ID }],
  ])('refuses a staff member %s', async (_, overrides) => {
    const res = await asAdmin.post('/api/users').send(newStaff(overrides));

    expect(res.status).toBe(400);
  });

  it.each([
    ['a missing name', { name: '  ' }],
    ['an invalid email', { email: 'not-an-email' }],
    ['an unknown role', { role: 'superuser' }],
    ['a short password', { password: 'short' }],
    ['a password longer than bcrypt can use', { password: 'x'.repeat(73) }],
  ])('rejects %s with 400', async (_, overrides) => {
    const res = await asAdmin.post('/api/users').send(newUser(overrides));

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
  });

  it('rejects an email that already has an account, in any letter case (409)', async () => {
    const res = await asAdmin.post('/api/users').send(newUser({ email: USERS.staff.email.toUpperCase() }));

    expect(res.status).toBe(409);
  });
});

describe('POST /api/users/:id/activation-code', () => {
  it('replaces a staff member’s activation code; the old one is gone', async () => {
    const created = (await asAdmin.post('/api/users').send(newStaff())).body;

    const res = await asAdmin.post(`/api/users/${created.user.id}/activation-code`);

    expect(res.status).toBe(200);
    expect(res.body.activationCode).not.toBe(created.activationCode);
    const codes = await pool.query('SELECT count(*)::int AS n FROM activation_codes WHERE user_id = $1 AND used_at IS NULL', [created.user.id]);
    expect(codes.rows[0].n).toBe(1);
  });

  it('is only for active school staff', async () => {
    expect((await asAdmin.post(`/api/users/${USERS.admin.id}/activation-code`)).status).toBe(400);
    expect((await asStaff.post(`/api/users/${USERS.staff.id}/activation-code`)).status).toBe(403);
  });
});

describe('PATCH /api/users/:id', () => {
  it('changes the role, which applies to existing sessions straight away', async () => {
    const res = await asAdmin.patch(`/api/users/${USERS.staff.id}`).send({ role: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
    // The staff member's old token still says school_staff, but the server uses the account
    expect((await asStaff.get('/api/users')).status).toBe(200);
  });

  it('deactivates a user: they cannot sign in and their session stops working', async () => {
    const res = await asAdmin.patch(`/api/users/${USERS.staff.id}`).send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.user.isActive).toBe(false);
    expect(await login(USERS.staff.email, USERS.staff.password)).toMatchObject({ status: 401, body: { error: 'Invalid email or password' } });
    expect((await asStaff.get('/api/schools')).status).toBe(401);
  });

  it('reactivates a user', async () => {
    await asAdmin.patch(`/api/users/${USERS.staff.id}`).send({ isActive: false });

    const res = await asAdmin.patch(`/api/users/${USERS.staff.id}`).send({ isActive: true });

    expect(res.body.user.isActive).toBe(true);
    expect((await asStaff.get('/api/schools')).status).toBe(200);
  });

  it.each([
    ['change their own role', { role: 'school_staff' }],
    ['deactivate themselves', { isActive: false }],
  ])('does not let an administrator %s', async (_, body) => {
    const res = await asAdmin.patch(`/api/users/${USERS.admin.id}`).send(body);

    expect(res.status).toBe(400);
    const row = await pool.query('SELECT role, is_active FROM users WHERE id = $1', [USERS.admin.id]);
    expect(row.rows[0]).toEqual({ role: 'admin', is_active: true });
  });

  it.each([
    ['nothing to change', {}],
    ['an unknown role', { role: 'owner' }],
    ['a non-boolean active flag', { isActive: 'no' }],
  ])('rejects %s with 400', async (_, body) => {
    const res = await asAdmin.patch(`/api/users/${USERS.staff.id}`).send(body);

    expect(res.status).toBe(400);
  });

  it('moves a staff member to another school, and clears the school when they become an administrator', async () => {
    await pool.query("INSERT INTO schools (id, name, location) VALUES ('22222222-2222-2222-2222-222222222222', 'Second School', 'Elsewhere')");

    const moved = await asAdmin.patch(`/api/users/${USERS.staff.id}`).send({ schoolId: '22222222-2222-2222-2222-222222222222' });
    const promoted = await asAdmin.patch(`/api/users/${USERS.staff.id}`).send({ role: 'admin' });

    expect(moved.body.user.schoolId).toBe('22222222-2222-2222-2222-222222222222');
    expect(promoted.body.user).toMatchObject({ role: 'admin', schoolId: null });
  });

  it('needs a school to make someone school staff', async () => {
    await createUser();
    const grace = (await pool.query("SELECT id FROM users WHERE email = 'grace@example.org'")).rows[0];

    const res = await asAdmin.patch(`/api/users/${grace.id}`).send({ role: 'school_staff' });

    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown or malformed id', async () => {
    expect((await asAdmin.patch(`/api/users/${MISSING_ID}`).send({ name: 'X' })).status).toBe(404);
    expect((await asAdmin.patch('/api/users/not-a-uuid').send({ name: 'X' })).status).toBe(404);
  });
});

describe('POST /api/users/:id/password (reset)', () => {
  it('sets a new password and ends the user’s existing sessions', async () => {
    // A session issued a few seconds before the reset
    const staleToken = jwt.sign(
      { name: USERS.staff.name, email: USERS.staff.email, role: 'school_staff', iat: Math.floor(Date.now() / 1000) - 5 },
      process.env.JWT_SECRET,
      { subject: USERS.staff.id, expiresIn: '1h', algorithm: 'HS256' }
    );

    const res = await asAdmin.post(`/api/users/${USERS.staff.id}/password`).send({ password: 'fresh-start-2026' });

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/password_hash|\$2[aby]\$/);
    expect(await passwordIs(USERS.staff.email, USERS.staff.password)).toBe(false);
    expect(await passwordIs(USERS.staff.email, 'fresh-start-2026')).toBe(true);
    const stale = await request(app).get('/api/schools').set('Authorization', `Bearer ${staleToken}`);
    expect(stale.status).toBe(401);
  });

  it('rejects a session for an account that does not exist (401)', async () => {
    const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { subject: MISSING_ID, expiresIn: '1h', algorithm: 'HS256' });

    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('rejects a short password with 400', async () => {
    const res = await asAdmin.post(`/api/users/${USERS.staff.id}/password`).send({ password: 'short' });

    expect(res.status).toBe(400);
  });
});

describe('PUT /api/auth/password (change your own)', () => {
  it('changes the password and returns a new session that keeps working', async () => {
    const res = await asStaff.put('/api/auth/password').send({ currentPassword: USERS.staff.password, newPassword: 'my-new-password-1' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token: expect.any(String), user: { id: USERS.staff.id } });
    const withNewToken = await request(app).get('/api/schools').set('Authorization', `Bearer ${res.body.token}`);
    expect(withNewToken.status).toBe(200);
    expect(await passwordIs(USERS.staff.email, 'my-new-password-1')).toBe(true);
  });

  it('works for administrators too', async () => {
    const created = await createUser();
    const session = (await login('grace@example.org', 'kitchen-ledger-42')).body;

    const res = await request(app).put('/api/auth/password').set('Authorization', `Bearer ${session.token}`)
      .send({ currentPassword: 'kitchen-ledger-42', newPassword: 'kitchen-ledger-43' });

    expect(created.role).toBe('admin');
    expect(res.status).toBe(200);
  });

  it.each([
    ['a wrong current password', { currentPassword: 'not-my-password', newPassword: 'my-new-password-1' }],
    ['a short new password', { currentPassword: USERS.staff.password, newPassword: 'short' }],
    ['the same password again', { currentPassword: USERS.staff.password, newPassword: USERS.staff.password }],
    ['no current password', { newPassword: 'my-new-password-1' }],
  ])('rejects %s with 400 and keeps the old password', async (_, body) => {
    const res = await asStaff.put('/api/auth/password').send(body);

    expect(res.status).toBe(400);
    expect(await passwordIs(USERS.staff.email, USERS.staff.password)).toBe(true);
  });

  it('requires sign-in (401)', async () => {
    const res = await request(app).put('/api/auth/password').send({ currentPassword: 'x', newPassword: 'my-new-password-1' });

    expect(res.status).toBe(401);
  });
});
