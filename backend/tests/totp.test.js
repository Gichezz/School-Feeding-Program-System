const request = require('supertest');
const app = require('../src/app');
const clock = require('../src/utils/clock');
const totp = require('../src/services/totp');
const { api, USERS } = require('./helpers/auth');
const { pool, resetDatabase } = require('./helpers/fixtures');

const asAdmin = api(app, 'admin');
const asStaff = api(app, 'staff');
const pinnedNow = clock.now;

beforeEach(resetDatabase);
afterEach(() => { clock.now = pinnedNow; });
afterAll(() => pool.end());

function codeFor(secret, stepsFromNow = 0) {
  return totp.codeAt(secret, totp.currentStep() + stepsFromNow);
}

function later(seconds) {
  const base = pinnedNow().getTime();
  clock.now = () => new Date(base + seconds * 1000);
}

function login(email = USERS.admin.email, password = USERS.admin.password) {
  return request(app).post('/api/auth/login').send({ email, password });
}

function totpLogin(code, { email = USERS.admin.email, password = USERS.admin.password } = {}) {
  return request(app).post('/api/auth/totp/login').send({ email, password, code });
}

/**
 * Set up and confirm an authenticator app for the seeded administrator. Returns the secret.
 */
async function enableTotp(as = asAdmin) {
  const { secret } = (await as.post('/api/auth/totp/setup')).body;
  await as.post('/api/auth/totp/confirm').send({ code: codeFor(secret) });
  // Sign-in codes must come from a later 30-second step than the confirming one, even
  // the previous step's code that is still accepted
  later(totp.STEP_SECONDS * 2);
  return secret;
}

describe('TOTP codes', () => {
  it('match the RFC 6238 test vector', () => {
    const secret = totp.base32Encode(Buffer.from('12345678901234567890'));

    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    // T = 59 s → 94287082 in the RFC; the last 6 digits
    expect(totp.codeAt(secret, 1)).toBe('287082');
    expect(totp.base32Decode(secret).toString()).toBe('12345678901234567890');
  });
});

describe('setting up an authenticator app', () => {
  it('gives a QR code, and turns on only once a code is confirmed', async () => {
    const setup = await asAdmin.post('/api/auth/totp/setup');

    expect(setup.status).toBe(200);
    expect(setup.body.qrCode).toMatch(/^data:image\/png;base64,/);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Lishe%3Aadmin%40demo-school\.local\?secret=[A-Z2-7]+&issuer=Lishe/);
    expect((await asAdmin.get('/api/auth/totp')).body.enabled).toBe(false);
    // Not confirmed yet: the password alone still signs in
    expect((await login()).status).toBe(200);

    const wrong = await asAdmin.post('/api/auth/totp/confirm').send({ code: '000000' });
    const right = await asAdmin.post('/api/auth/totp/confirm').send({ code: codeFor(setup.body.secret) });

    expect(wrong.status).toBe(400);
    expect(right.status).toBe(200);
    expect(right.body.enabled).toBe(true);
    expect(right.body.recoveryCodes).toHaveLength(10);
    expect((await asAdmin.get('/api/auth/totp')).body.enabled).toBe(true);
  });

  it('stores the secret encrypted and never shows it again', async () => {
    const secret = await enableTotp();

    const stored = (await pool.query('SELECT secret_encrypted FROM totp_credentials')).rows[0].secret_encrypted;
    expect(stored).not.toContain(secret);
    expect(JSON.stringify((await asAdmin.get('/api/auth/totp')).body)).not.toContain(secret);
    expect((await asAdmin.post('/api/auth/totp/setup')).status).toBe(409);
  });

  it('is for administrators only', async () => {
    expect((await asStaff.post('/api/auth/totp/setup')).status).toBe(403);
    expect((await totpLogin('123456', { email: USERS.staff.email, password: USERS.staff.password })).status).toBe(401);
  });

  it('stops asking the administrator to add a passkey', async () => {
    expect((await login()).body.user.needsPasskey).toBe(true);
    const secret = await enableTotp();

    expect((await totpLogin(codeFor(secret))).body.user.needsPasskey).toBe(false);
  });
});

describe('signing in with password + code', () => {
  it('needs the code once the app is set up', async () => {
    await enableTotp();

    const res = await login();

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ totpRequired: true, passkeyRequired: false });
  });

  it('accepts the current code, and codes one step either side', async () => {
    const secret = await enableTotp();

    expect((await totpLogin(codeFor(secret, -1))).status).toBe(200);
    later(totp.STEP_SECONDS * 4);
    expect((await totpLogin(codeFor(secret, 1))).status).toBe(200);
  });

  it('refuses codes outside the window', async () => {
    const secret = await enableTotp();

    expect((await totpLogin(codeFor(secret, 2))).status).toBe(401);
    expect((await totpLogin(codeFor(secret, -2))).status).toBe(401);
  });

  it('never accepts the same code twice', async () => {
    const secret = await enableTotp();
    const code = codeFor(secret);

    expect((await totpLogin(code)).status).toBe(200);
    const again = await totpLogin(code);

    expect(again.status).toBe(401);
    expect(again.body.error).toMatch(/already used/);
  });

  it('gives the same answer for a wrong password as for an unknown account', async () => {
    const secret = await enableTotp();

    const wrongPassword = await totpLogin(codeFor(secret), { password: 'not-the-password' });
    const unknown = await totpLogin(codeFor(secret), { email: 'nobody@example.org' });

    expect(wrongPassword.status).toBe(401);
    expect(unknown.body).toEqual(wrongPassword.body);
  });

  it('pauses code sign-in after 5 wrong codes, then allows it again after 15 minutes', async () => {
    const secret = await enableTotp();
    const wrong = codeFor(secret) === '111111' ? '222222' : '111111';

    for (let i = 0; i < 4; i += 1) expect((await totpLogin(wrong)).status).toBe(401);
    expect((await totpLogin(wrong)).status).toBe(429);
    // Even the right code waits until the pause ends
    expect((await totpLogin(codeFor(secret))).status).toBe(429);

    later(totp.STEP_SECONDS * 2 + totp.LOCK_MINUTES * 60);
    expect((await totpLogin(codeFor(secret))).status).toBe(200);
  });

  it('does not count wrong passwords against the code limit', async () => {
    const secret = await enableTotp();

    for (let i = 0; i < 6; i += 1) await totpLogin('123456', { password: 'not-the-password' });

    expect((await totpLogin(codeFor(secret))).status).toBe(200);
  });

  it('lets the recovery codes stand in for the app', async () => {
    const { secret } = (await asAdmin.post('/api/auth/totp/setup')).body;
    const { recoveryCodes } = (await asAdmin.post('/api/auth/totp/confirm').send({ code: codeFor(secret) })).body;

    const res = await request(app).post('/api/auth/recovery').send({ email: USERS.admin.email, password: USERS.admin.password, code: recoveryCodes[0] });

    expect(res.status).toBe(200);
    expect(res.body.recoveryCodesLeft).toBe(9);
    expect((await asAdmin.post('/api/auth/recovery-codes')).body.recoveryCodes).toHaveLength(10);
  });
});

describe('removing and resetting the app', () => {
  it('keeps the app while it is the only second step', async () => {
    await enableTotp();

    expect((await asAdmin.delete('/api/auth/totp')).status).toBe(400);
  });

  it('can be removed once the administrator has a passkey', async () => {
    await enableTotp();
    await pool.query(
      "INSERT INTO passkey_credentials (user_id, credential_id, public_key, name) VALUES ($1, 'credential-1', '\\x00', 'Laptop')",
      [USERS.admin.id]
    );

    expect((await asAdmin.delete('/api/auth/totp')).status).toBe(204);
    expect((await asAdmin.get('/api/auth/totp')).body.enabled).toBe(false);
    expect((await login()).body).toMatchObject({ passkeyRequired: true });
  });

  it('can be reset by another administrator, who sees it in the users list', async () => {
    await asAdmin.post('/api/users').send({ name: 'Second Admin', email: 'second@example.org', role: 'admin', password: 'second-admin-pass' });
    const session = (await login('second@example.org', 'second-admin-pass')).body;
    const asSecond = { post: (url) => request(app).post(url).set('Authorization', `Bearer ${session.token}`) };
    const { secret } = (await asSecond.post('/api/auth/totp/setup')).body;
    await asSecond.post('/api/auth/totp/confirm').send({ code: codeFor(secret) });
    const second = (await pool.query("SELECT id FROM users WHERE email = 'second@example.org'")).rows[0];

    const listed = (await asAdmin.get('/api/users')).body.users.find((u) => u.id === second.id);
    const res = await asAdmin.post(`/api/users/${second.id}/passkeys/reset`);

    expect(listed).toMatchObject({ totpEnabled: true, passkeyCount: 0 });
    expect(res.body.user).toMatchObject({ totpEnabled: false });
    expect((await pool.query('SELECT count(*)::int AS n FROM totp_credentials WHERE user_id = $1', [second.id])).rows[0].n).toBe(0);
    expect((await login('second@example.org', 'second-admin-pass')).status).toBe(200);
  });
});
