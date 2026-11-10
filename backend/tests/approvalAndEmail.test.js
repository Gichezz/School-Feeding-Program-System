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

describe('approval emails', () => {
  it('tell the staff set up on the device that they can sign in now', async () => {
    isEmailConfigured.mockReturnValue(true);
    const device = (await enrol(makeDevice(), { email: USERS.staff.email, password: USERS.staff.password, pin: '482915' })).body.device;

    await asAdmin.post(`/api/devices/${device.id}/approve`);

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: USERS.staff.email, subject: 'Your school device is ready', text: expect.stringContaining('Kitchen tablet has been approved'),
    }));
  });

  it('are sent once, and a failed email does not undo the approval', async () => {
    isEmailConfigured.mockReturnValue(true);
    sendMail.mockResolvedValue({ sent: false, error: 'connection refused' });
    const device = (await enrol(makeDevice(), { email: USERS.staff.email, password: USERS.staff.password, pin: '482915' })).body.device;

    expect((await asAdmin.post(`/api/devices/${device.id}/approve`)).status).toBe(200);
    expect((await asAdmin.post(`/api/devices/${device.id}/approve`)).status).toBe(200);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect((await statusOf(device.id)).body).toEqual({ status: 'approved' });
  });
});

describe('activation codes by email', () => {
  const teacher = { name: 'Peter Otieno', email: 'peter@example.org', role: 'school_staff', schoolId: SCHOOL_ID };
  const codeIn = (call) => call[0].text.match(/activation code is: (\S+)/)[1];

  it('go only to the teacher’s address, so the administrator does not see the code', async () => {
    isEmailConfigured.mockReturnValue(true);

    const res = await asAdmin.post('/api/users').send(teacher);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ activationEmailed: true, activationExpiresAt: expect.any(String) });
    expect(res.body.activationCode).toBeUndefined();
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'peter@example.org', subject: 'Your Lishe activation code' }));
    expect(res.body.user.emailVerified).toBe(false);
  });

  it('verify the address once the teacher uses the emailed code', async () => {
    isEmailConfigured.mockReturnValue(true);
    const created = (await asAdmin.post('/api/users').send(teacher)).body.user;
    const code = codeIn(sendMail.mock.calls[0]);

    const res = await enrol(makeDevice(), { email: 'peter@example.org', activationCode: code, newPassword: 'peters-own-password', pin: '739104' });

    expect(res.status).toBe(201);
    const users = (await asAdmin.get('/api/users')).body.users;
    expect(users.find((u) => u.id === created.id).emailVerified).toBe(true);
  });

  it('are shown to the administrator when email is not set up, and the address stays unverified', async () => {
    const res = await asAdmin.post('/api/users').send(teacher);

    expect(res.body.activationCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(sendMail).not.toHaveBeenCalled();
    await enrol(makeDevice(), { email: 'peter@example.org', activationCode: res.body.activationCode, newPassword: 'peters-own-password', pin: '739104' });
    const users = (await asAdmin.get('/api/users')).body.users;
    expect(users.find((u) => u.email === 'peter@example.org').emailVerified).toBe(false);
  });

  it('fall back to the administrator when the email cannot be sent', async () => {
    isEmailConfigured.mockReturnValue(true);
    sendMail.mockResolvedValue({ sent: false, error: 'connection refused' });

    const res = await asAdmin.post('/api/users').send(teacher);

    expect(res.body).toMatchObject({ emailFailed: true, activationCode: expect.any(String) });
    const stored = (await pool.query('SELECT emailed FROM activation_codes')).rows[0];
    expect(stored.emailed).toBe(false);
  });

  it('are emailed again when the administrator issues a new one', async () => {
    isEmailConfigured.mockReturnValue(true);
    const created = (await asAdmin.post('/api/users').send(teacher)).body.user;

    const res = await asAdmin.post(`/api/users/${created.id}/activation-code`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ activationEmailed: true });
    expect(sendMail).toHaveBeenCalledTimes(2);
  });
});
