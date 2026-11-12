jest.mock('../src/services/mailer', () => {
  const actual = jest.requireActual('../src/services/mailer');
  return { ...actual, isEmailConfigured: jest.fn(() => false), sendMail: jest.fn(async () => ({ sent: true })) };
});

const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const { api, USERS } = require('./helpers/auth');
const { pool, SCHOOL_ID, resetDatabase } = require('./helpers/fixtures');
const { isEmailConfigured, sendMail } = require('../src/services/mailer');

/**
 * How a feeding teacher finds out their device is approved (the device asks, and an
 * email says so), and activation codes sent by email so that only the owner of the
 * address can activate the account, which verifies the address.
 */

const asAdmin = api(app, 'admin');

beforeEach(async () => {
  await resetDatabase();
  isEmailConfigured.mockReset().mockReturnValue(false);
  sendMail.mockReset().mockResolvedValue({ sent: true });
});
afterAll(() => pool.end());

function makeDevice() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    publicKey: publicKey.export({ format: 'jwk' }),
    sign: (challenge) => crypto.sign('sha256', Buffer.from(challenge, 'utf8'), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url'),
  };
}

async function enrol(device, body) {
  const { challenge } = (await request(app).post('/api/devices/challenge')).body;
  return request(app).post('/api/devices/enrol').send({ challenge, signature: device.sign(challenge), publicKey: device.publicKey, deviceName: 'Kitchen tablet', ...body });
}

const statusOf = (deviceId) => request(app).post('/api/devices/status').send({ deviceId });

describe('a device waiting for approval', () => {
  it('can ask whether it has been approved, and is told only its status', async () => {
    const device = (await enrol(makeDevice(), { email: USERS.staff.email, password: USERS.staff.password, pin: '482915' })).body.device;

    const waiting = await statusOf(device.id);
    expect(waiting.status).toBe(200);
    expect(waiting.body).toEqual({ status: 'pending' });

    await asAdmin.post(`/api/devices/${device.id}/approve`);
    expect((await statusOf(device.id)).body).toEqual({ status: 'approved' });

    await asAdmin.post(`/api/devices/${device.id}/revoke`);
    expect((await statusOf(device.id)).body).toEqual({ status: 'revoked' });
  });

  it('gets nothing for a device it does not know', async () => {
    expect((await statusOf('11111111-2222-4333-8444-555555555555')).status).toBe(404);
    expect((await statusOf('not-a-device')).status).toBe(404);
  });
});

/** The approval notice is sent after the approval is answered; wait for its records. */
async function deliveriesFor(kind, count) {
  for (let i = 0; i < 50; i += 1) {
    const rows = (await pool.query("SELECT * FROM email_deliveries WHERE kind = $1 AND status <> 'queued' ORDER BY created_at", [kind])).rows;
    if (rows.length >= count) return rows;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return (await pool.query('SELECT * FROM email_deliveries WHERE kind = $1', [kind])).rows;
}

const verify = (email) => pool.query('UPDATE users SET email_verified_at = NOW() WHERE email = $1', [email]);

describe('approval emails', () => {
  it('tell the verified staff set up on the device that they can sign in now', async () => {
    isEmailConfigured.mockReturnValue(true);
    await verify(USERS.staff.email);
    const device = (await enrol(makeDevice(), { email: USERS.staff.email, password: USERS.staff.password, pin: '482915' })).body.device;

    await asAdmin.post(`/api/devices/${device.id}/approve`);

    const [delivery] = await deliveriesFor('device_approved', 1);
    expect(delivery).toMatchObject({ status: 'accepted', user_id: USERS.staff.id, device_id: device.id, attempts: 1 });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: USERS.staff.email, subject: 'Your school device is ready', text: expect.stringContaining('Kitchen tablet has been approved'),
    }));
    // Nothing secret in it
    expect(sendMail.mock.calls[0][0].text).not.toMatch(/PIN is|password is|code is/i);
  });

  it('are not sent to staff whose address is not verified', async () => {
    isEmailConfigured.mockReturnValue(true);
    const device = (await enrol(makeDevice(), { email: USERS.staff.email, password: USERS.staff.password, pin: '482915' })).body.device;

    await asAdmin.post(`/api/devices/${device.id}/approve`);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(sendMail).not.toHaveBeenCalled();
  });

  it('are sent once; a failed one is recorded, never undoes the approval, and can be sent again', async () => {
    isEmailConfigured.mockReturnValue(true);
    await verify(USERS.staff.email);
    sendMail.mockResolvedValue({ sent: false, error: 'connection refused' });
    const device = (await enrol(makeDevice(), { email: USERS.staff.email, password: USERS.staff.password, pin: '482915' })).body.device;

    expect((await asAdmin.post(`/api/devices/${device.id}/approve`)).status).toBe(200);
    expect((await asAdmin.post(`/api/devices/${device.id}/approve`)).status).toBe(200);
    const [failed] = await deliveriesFor('device_approved', 1);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(failed).toMatchObject({ status: 'failed', last_error: 'connection refused' });
    expect((await statusOf(device.id)).body).toEqual({ status: 'approved' });
    const staff = (await asAdmin.get('/api/devices')).body.devices.find((d) => d.id === device.id).staff[0];
    expect(staff).toMatchObject({ emailVerified: true, approvalEmail: 'failed' });

    sendMail.mockResolvedValue({ sent: true });
    const again = await asAdmin.post(`/api/devices/${device.id}/approval-email`);
    expect(again.body).toEqual({ sent: [{ status: 'accepted' }] });
    // Only the failed one is sent again
    expect((await asAdmin.post(`/api/devices/${device.id}/approval-email`)).body).toEqual({ sent: [] });
    expect((await pool.query("SELECT approved_at FROM devices WHERE id = $1", [device.id])).rows[0].approved_at).not.toBeNull();
  });
});

describe('activation codes by email', () => {
  const teacher = { name: 'Peter Otieno', email: 'peter@example.org', role: 'school_staff', schoolId: SCHOOL_ID };
  const codeIn = (call) => call[0].text.match(/activation code is: (\S+)/)[1];

  it('go only to the teacher’s address; the administrator sees that the provider accepted it, never the code', async () => {
    isEmailConfigured.mockReturnValue(true);

    const res = await asAdmin.post('/api/users').send(teacher);

    expect(res.status).toBe(201);
    expect(res.body.activation).toEqual({ status: 'accepted', emailConfigured: true, expiresAt: expect.any(String) });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'peter@example.org', subject: 'Your Lishe activation code' }));
    expect(JSON.stringify(res.body)).not.toContain(codeIn(sendMail.mock.calls[0]));
    expect(res.body.user.emailVerified).toBe(false);
    const listed = (await asAdmin.get('/api/users')).body.users.find((u) => u.id === res.body.user.id);
    expect(listed.activation).toMatchObject({ activated: false, email: 'accepted' });
  });

  it('verify the address once the teacher uses the emailed code, and the history says so', async () => {
    isEmailConfigured.mockReturnValue(true);
    const created = (await asAdmin.post('/api/users').send(teacher)).body.user;
    const code = codeIn(sendMail.mock.calls[0]);

    const res = await enrol(makeDevice(), { email: 'peter@example.org', activationCode: code, newPassword: 'peters-own-password', pin: '739104' });

    expect(res.status).toBe(201);
    const users = (await asAdmin.get('/api/users')).body.users;
    expect(users.find((u) => u.id === created.id)).toMatchObject({ emailVerified: true, activation: { activated: true } });
    const history = (await asAdmin.get(`/api/users/${created.id}/history`)).body;
    expect(history.events.map((e) => e.kind)).toEqual(['activated', 'activation_emailed']);
    expect(history.emails).toEqual([expect.objectContaining({ kind: 'activation', status: 'accepted', attempts: 1 })]);
  });

  it('leave the account waiting when the email cannot be sent: no code is shown, and it can be sent again', async () => {
    isEmailConfigured.mockReturnValue(true);
    sendMail.mockResolvedValue({ sent: false, error: 'connection refused' });

    const res = await asAdmin.post('/api/users').send(teacher);

    expect(res.body.activation).toMatchObject({ status: 'failed' });
    expect(res.body).not.toHaveProperty('activationCode');
    const history = (await asAdmin.get(`/api/users/${res.body.user.id}/history`)).body;
    expect(history.events[0].kind).toBe('activation_email_failed');
    expect(history.emails[0]).toMatchObject({ status: 'failed', error: 'connection refused' });

    sendMail.mockResolvedValue({ sent: true });
    const again = await asAdmin.post(`/api/users/${res.body.user.id}/activation/email`);
    expect(again.body.activation).toMatchObject({ status: 'accepted' });
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('stop working after 5 wrong tries, which the history records', async () => {
    isEmailConfigured.mockReturnValue(true);
    const created = (await asAdmin.post('/api/users').send(teacher)).body.user;
    const code = codeIn(sendMail.mock.calls[0]);
    const attempt = (activationCode) => enrol(makeDevice(), { email: 'peter@example.org', activationCode, newPassword: 'peters-own-password', pin: '739104' });

    for (let i = 0; i < 5; i += 1) expect((await attempt('AAAA-BBBB-CCCC')).status).toBe(401);
    const right = await attempt(code);

    expect(right.status).toBe(401);
    const history = (await asAdmin.get(`/api/users/${created.id}/history`)).body;
    expect(history.events[0].kind).toBe('activation_code_locked');
  });
});

describe('a device not approved within 14 days', () => {
  const age = (deviceId, days) => pool.query(`UPDATE devices SET created_at = NOW() - make_interval(days => $2) WHERE id = $1`, [deviceId, days]);
  const statusIn = async (deviceId) => (await pool.query('SELECT status, expired_at FROM devices WHERE id = $1', [deviceId])).rows[0];
  afterEach(() => { delete process.env.DEVICE_PENDING_DAYS; });

  it('expires: it stops being asked about, cannot be approved or signed in on, and stays on record', async () => {
    const key = makeDevice();
    const device = (await enrol(key, { email: USERS.staff.email, password: USERS.staff.password, pin: '482915' })).body.device;
    await age(device.id, 15);

    const polled = await statusOf(device.id);
    expect(polled.status).toBe(410);
    expect(polled.body).toMatchObject({ status: 'expired' });
    expect((await asAdmin.post(`/api/devices/${device.id}/approve`)).status).toBe(400);
    const { challenge } = (await request(app).post('/api/devices/challenge')).body;
    const signIn = await request(app).post('/api/devices/sign-in')
      .send({ email: USERS.staff.email, pin: '482915', deviceId: device.id, challenge, signature: key.sign(challenge) });
    expect(signIn.status).toBe(403);
    expect(signIn.body.deviceExpired).toBe(true);
    const again = await enrol(key, { email: USERS.staff.email, password: USERS.staff.password, pin: '482915', deviceId: device.id });
    expect(again.status).toBe(409);
    expect(again.body.deviceExpired).toBe(true);

    const listed = (await asAdmin.get('/api/devices')).body.devices.find((d) => d.id === device.id);
    expect(listed).toMatchObject({ status: 'expired', expiredAt: expect.any(String) });
  });

  it('can be set up again as a new registration, while the expired one stays on record', async () => {
    const old = (await enrol(makeDevice(), { email: USERS.staff.email, password: USERS.staff.password, pin: '482915' })).body.device;
    await age(old.id, 15);
    await statusOf(old.id);

    const fresh = await enrol(makeDevice(), { email: USERS.staff.email, password: USERS.staff.password, pin: '482915' });

    expect(fresh.status).toBe(201);
    expect(fresh.body.device).toMatchObject({ status: 'pending' });
    expect(fresh.body.device.id).not.toBe(old.id);
    expect(await statusIn(old.id)).toMatchObject({ status: 'expired', expired_at: expect.any(Date) });
  });

  it('never expires an approved device, and waits 14 days by default or DEVICE_PENDING_DAYS', async () => {
    const approved = (await enrol(makeDevice(), { email: USERS.staff.email, password: USERS.staff.password, pin: '482915' })).body.device;
    await asAdmin.post(`/api/devices/${approved.id}/approve`);
    await age(approved.id, 400);
    const waiting = (await enrol(makeDevice(), { email: USERS.staff.email, password: USERS.staff.password, pin: '482915' })).body.device;
    await age(waiting.id, 13);

    await asAdmin.get('/api/devices');
    expect((await statusIn(approved.id)).status).toBe('approved');
    expect((await statusIn(waiting.id)).status).toBe('pending');

    await age(waiting.id, 20);
    process.env.DEVICE_PENDING_DAYS = '30';
    await asAdmin.get('/api/devices');
    expect((await statusIn(waiting.id)).status).toBe('pending');
  });
});
