// The WebAuthn signature checks need a real authenticator, so the two verify functions
// are mocked. Option generation is real. The tests cover everything around the checks:
// one-time challenges, what is passed to the library, storage, sign-in rules and recovery.
jest.mock('@simplewebauthn/server', () => ({
  ...jest.requireActual('@simplewebauthn/server'),
  verifyRegistrationResponse: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));

const request = require('supertest');
const { verifyRegistrationResponse, verifyAuthenticationResponse } = require('@simplewebauthn/server');
const app = require('../src/app');
const { api, USERS } = require('./helpers/auth');
const { pool, resetDatabase } = require('./helpers/fixtures');

const asAdmin = api(app, 'admin');
const asStaff = api(app, 'staff');
const ORIGIN = 'http://localhost:5173';

beforeEach(async () => {
  await resetDatabase();
  verifyRegistrationResponse.mockReset();
  verifyAuthenticationResponse.mockReset();
});
afterAll(() => pool.end());

/**
 * A browser response carrying the given challenge, in the shape @simplewebauthn/browser sends.
 */
function browserResponse(challenge, id = 'credential-1', type = 'webauthn.create') {
  const clientDataJSON = Buffer.from(JSON.stringify({ type, challenge, origin: ORIGIN })).toString('base64url');
  return { id, rawId: id, type: 'public-key', response: { clientDataJSON }, clientExtensionResults: {} };
}

function registrationVerified(id = 'credential-1') {
  verifyRegistrationResponse.mockResolvedValue({
    verified: true,
    registrationInfo: { credential: { id, publicKey: new Uint8Array([1, 2, 3, 4]), counter: 0, transports: ['internal'] } },
  });
}

async function registerPasskey(as = asAdmin, { id = 'credential-1', name = 'Office laptop' } = {}) {
  const options = await as.post('/api/auth/passkeys/register/options');
  registrationVerified(id);
  return as.post('/api/auth/passkeys/register/verify').send({ response: browserResponse(options.body.challenge, id), name });
}

async function signInWithPasskey(id = 'credential-1', { newCounter = 1 } = {}) {
  const options = await request(app).post('/api/auth/passkeys/login/options');
  verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter } });
  return request(app).post('/api/auth/passkeys/login/verify').send({ response: browserResponse(options.body.challenge, id, 'webauthn.get') });
}

function login(email, password) {
  return request(app).post('/api/auth/login').send({ email, password });
}

describe('registering a passkey', () => {
  it('is for signed-in administrators only', async () => {
    expect((await request(app).post('/api/auth/passkeys/register/options')).status).toBe(401);
    expect((await asStaff.post('/api/auth/passkeys/register/options')).status).toBe(403);
  });

  it('gives creation options for a discoverable passkey that needs user verification', async () => {
    const res = await asAdmin.post('/api/auth/passkeys/register/options');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      rp: { id: 'localhost', name: 'Lishe' },
      user: { name: USERS.admin.email, displayName: USERS.admin.name },
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      challenge: expect.any(String),
    });
  });

  it('saves the passkey, checks it against the challenge, origin and RP ID, and returns recovery codes the first time', async () => {
    const options = await asAdmin.post('/api/auth/passkeys/register/options');
    registrationVerified();

    const res = await asAdmin.post('/api/auth/passkeys/register/verify')
      .send({ response: browserResponse(options.body.challenge), name: 'Office laptop' });

    expect(res.status).toBe(201);
    expect(res.body.passkey).toMatchObject({ name: 'Office laptop', lastUsedAt: null });
    expect(res.body.recoveryCodes).toHaveLength(10);
    expect(new Set(res.body.recoveryCodes).size).toBe(10);
    res.body.recoveryCodes.forEach((code) => expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/));
    expect(verifyRegistrationResponse).toHaveBeenCalledWith(expect.objectContaining({
      expectedChallenge: options.body.challenge,
      expectedOrigin: [ORIGIN],
      expectedRPID: 'localhost',
      requireUserVerification: true,
    }));
    const stored = await pool.query('SELECT credential_id, counter, transports FROM passkey_credentials WHERE user_id = $1', [USERS.admin.id]);
    expect(stored.rows).toEqual([{ credential_id: 'credential-1', counter: '0', transports: ['internal'] }]);
    const codes = await pool.query('SELECT code_hash FROM recovery_codes WHERE user_id = $1', [USERS.admin.id]);
    expect(codes.rows).toHaveLength(10);
    codes.rows.forEach((row) => expect(row.code_hash).toMatch(/^\$2[aby]\$10\$/));
  });

  it('does not return recovery codes with later passkeys', async () => {
    await registerPasskey();

    const res = await registerPasskey(asAdmin, { id: 'credential-2', name: 'Phone' });

    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('recoveryCodes');
  });

  it('rejects a response whose challenge was never issued, without calling the verifier', async () => {
    const res = await asAdmin.post('/api/auth/passkeys/register/verify').send({ response: browserResponse('made-up-challenge') });

    expect(res.status).toBe(400);
    expect(verifyRegistrationResponse).not.toHaveBeenCalled();
  });

  it('uses each challenge once', async () => {
    const options = await asAdmin.post('/api/auth/passkeys/register/options');
    registrationVerified();
    await asAdmin.post('/api/auth/passkeys/register/verify').send({ response: browserResponse(options.body.challenge) });

    const replay = await asAdmin.post('/api/auth/passkeys/register/verify').send({ response: browserResponse(options.body.challenge, 'credential-2') });

    expect(replay.status).toBe(400);
  });

  it('rejects a response the library cannot verify (e.g. wrong origin)', async () => {
    const options = await asAdmin.post('/api/auth/passkeys/register/options');
    verifyRegistrationResponse.mockRejectedValue(new Error('Unexpected registration response origin'));

    const res = await asAdmin.post('/api/auth/passkeys/register/verify').send({ response: browserResponse(options.body.challenge) });

    expect(res.status).toBe(400);
    expect((await pool.query('SELECT count(*)::int AS n FROM passkey_credentials')).rows[0].n).toBe(0);
  });

  it('rejects the same passkey twice (409)', async () => {
    await registerPasskey();

    const res = await registerPasskey();

    expect(res.status).toBe(409);
  });
});

describe('signing in with a passkey', () => {
  beforeEach(() => registerPasskey());

  it('signs the administrator in and records the use', async () => {
    const res = await signInWithPasskey('credential-1', { newCounter: 5 });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: USERS.admin.id, role: 'admin', needsPasskey: false });
    expect((await request(app).get('/api/schools').set('Authorization', `Bearer ${res.body.token}`)).status).toBe(200);
    expect(verifyAuthenticationResponse).toHaveBeenCalledWith(expect.objectContaining({
      expectedOrigin: [ORIGIN],
      expectedRPID: 'localhost',
      requireUserVerification: true,
      credential: expect.objectContaining({ id: 'credential-1', counter: 0 }),
    }));
    const stored = await pool.query('SELECT counter, last_used_at FROM passkey_credentials');
    expect(stored.rows[0].counter).toBe('5');
    expect(stored.rows[0].last_used_at).not.toBeNull();
  });

  it('rejects an unknown passkey', async () => {
    expect((await signInWithPasskey('someone-elses-credential')).status).toBe(401);
  });

  it('rejects a passkey whose account is deactivated', async () => {
    await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [USERS.admin.id]);

    expect((await signInWithPasskey()).status).toBe(401);
  });

  it('rejects a response the library does not verify', async () => {
    const options = await request(app).post('/api/auth/passkeys/login/options');
    verifyAuthenticationResponse.mockResolvedValue({ verified: false });

    const res = await request(app).post('/api/auth/passkeys/login/verify').send({ response: browserResponse(options.body.challenge, 'credential-1', 'webauthn.get') });

    expect(res.status).toBe(401);
  });

  it('uses each sign-in challenge once', async () => {
    const options = await request(app).post('/api/auth/passkeys/login/options');
    verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 1 } });
    const response = browserResponse(options.body.challenge, 'credential-1', 'webauthn.get');
    await request(app).post('/api/auth/passkeys/login/verify').send({ response });

    const replay = await request(app).post('/api/auth/passkeys/login/verify').send({ response });

    expect(replay.status).toBe(401);
  });

  it('does not accept a registration challenge for sign-in', async () => {
    const options = await asAdmin.post('/api/auth/passkeys/register/options');
    verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 1 } });

    const res = await request(app).post('/api/auth/passkeys/login/verify').send({ response: browserResponse(options.body.challenge, 'credential-1', 'webauthn.get') });

    expect(res.status).toBe(401);
  });
});

describe('password sign-in for administrators', () => {
  it('works without a passkey, and asks the administrator to add one', async () => {
    const res = await login(USERS.admin.email, USERS.admin.password);

    expect(res.status).toBe(200);
    expect(res.body.user.needsPasskey).toBe(true);
  });

  it('is refused once the account has a passkey', async () => {
    await registerPasskey();

    const res = await login(USERS.admin.email, USERS.admin.password);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ passkeyRequired: true });
    expect(res.body).not.toHaveProperty('token');
  });

  it('still gives the usual message for a wrong password', async () => {
    await registerPasskey();

    const res = await login(USERS.admin.email, 'wrong-password');

    expect(res).toMatchObject({ status: 401, body: { error: 'Invalid email or password' } });
  });

  it('is refused for school staff, who sign in on a school device instead (#60)', async () => {
    const res = await login(USERS.staff.email, USERS.staff.password);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ deviceRequired: true });
    expect(res.body).not.toHaveProperty('token');
  });
});

describe('recovery codes', () => {
  let codes;
  beforeEach(async () => {
    codes = (await registerPasskey()).body.recoveryCodes;
  });

  function recover(code, password = USERS.admin.password) {
    return request(app).post('/api/auth/recovery').send({ email: USERS.admin.email, password, code });
  }

  it('sign in with the password and one code, which is then spent', async () => {
    const res = await recover(codes[0]);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token: expect.any(String), recoveryCodesLeft: 9 });
    expect((await recover(codes[0])).status).toBe(401);
  });

  it('accept a code typed in lower case without the dash', async () => {
    expect((await recover(codes[1].replace('-', '').toLowerCase())).status).toBe(200);
  });

  it('need the right password', async () => {
    expect((await recover(codes[0], 'wrong-password')).status).toBe(401);
  });

  it('do not work for accounts without recovery codes', async () => {
    const res = await request(app).post('/api/auth/recovery').send({ email: USERS.staff.email, password: USERS.staff.password, code: codes[0] });

    expect(res.status).toBe(401);
  });

  it('can be replaced; the old ones stop working', async () => {
    const fresh = await asAdmin.post('/api/auth/recovery-codes');

    expect(fresh.body.recoveryCodes).toHaveLength(10);
    expect((await recover(codes[0])).status).toBe(401);
    expect((await recover(fresh.body.recoveryCodes[0])).status).toBe(200);
  });

  it('show how many are left in the passkey list', async () => {
    await recover(codes[0]);

    const res = await asAdmin.get('/api/auth/passkeys');

    expect(res.body).toMatchObject({ recoveryCodesLeft: 9, passkeys: [{ name: 'Office laptop' }] });
  });
});

describe('removing passkeys', () => {
  it('keeps at least one passkey', async () => {
    const only = (await registerPasskey()).body.passkey;

    const res = await asAdmin.delete(`/api/auth/passkeys/${only.id}`);

    expect(res.status).toBe(400);
  });

  it('removes one of several', async () => {
    const first = (await registerPasskey()).body.passkey;
    await registerPasskey(asAdmin, { id: 'credential-2', name: 'Phone' });

    const res = await asAdmin.delete(`/api/auth/passkeys/${first.id}`);

    expect(res.status).toBe(204);
    expect((await asAdmin.get('/api/auth/passkeys')).body.passkeys.map((p) => p.name)).toEqual(['Phone']);
  });

  it('cannot remove another account’s passkey', async () => {
    const res = await asAdmin.delete('/api/auth/passkeys/00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(404);
  });
});

describe('an administrator resetting another administrator’s passkeys', () => {
  it('removes their passkeys and codes, ends their sessions, and lets them use their password again', async () => {
    // A second administrator with a passkey and a live session
    await asAdmin.post('/api/users').send({ name: 'Second Admin', email: 'second@example.org', role: 'admin', password: 'second-admin-pass' });
    const session = (await login('second@example.org', 'second-admin-pass')).body;
    const asSecond = {
      post: (url) => request(app).post(url).set('Authorization', `Bearer ${session.token}`),
    };
    await registerPasskey(asSecond, { id: 'second-credential' });
    const second = (await pool.query("SELECT id FROM users WHERE email = 'second@example.org'")).rows[0];
    // Make the existing session older than the reset
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const res = await asAdmin.post(`/api/users/${second.id}/passkeys/reset`);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ passkeyCount: 0 });
    expect((await pool.query('SELECT count(*)::int AS n FROM passkey_credentials WHERE user_id = $1', [second.id])).rows[0].n).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM recovery_codes WHERE user_id = $1', [second.id])).rows[0].n).toBe(0);
    expect((await request(app).get('/api/schools').set('Authorization', `Bearer ${session.token}`)).status).toBe(401);
    expect((await login('second@example.org', 'second-admin-pass')).body.user.needsPasskey).toBe(true);
  });

  it('is not allowed on your own account, or for school staff', async () => {
    expect((await asAdmin.post(`/api/users/${USERS.admin.id}/passkeys/reset`)).status).toBe(400);
    expect((await asStaff.post(`/api/users/${USERS.admin.id}/passkeys/reset`)).status).toBe(403);
  });

  it('shows each user’s passkey count in the users list', async () => {
    await registerPasskey();

    const users = (await asAdmin.get('/api/users')).body.users;

    expect(users.find((u) => u.id === USERS.admin.id).passkeyCount).toBe(1);
    expect(users.find((u) => u.id === USERS.staff.id).passkeyCount).toBe(0);
  });
});
