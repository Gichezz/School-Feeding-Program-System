const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const { api, USERS } = require('./helpers/auth');
const { pool, SCHOOL_ID, MISSING_ID, resetDatabase, attendancePayload, syncOperation } = require('./helpers/fixtures');

const asAdmin = api(app, 'admin');
const asStaff = api(app, 'staff');
const OTHER_SCHOOL_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(resetDatabase);
afterAll(() => pool.end());

/**
 * A device key pair like the browser makes (P-256), signing challenges the way WebCrypto
 * does (raw r||s). Nothing here is mocked: the server checks real signatures.
 */
function makeDevice() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  return {
    publicKey: jwk,
    sign: (challenge) => crypto.sign('sha256', Buffer.from(challenge, 'utf8'), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url'),
  };
}

async function getChallenge() {
  return (await request(app).post('/api/devices/challenge')).body.challenge;
}

async function enrol(device, body) {
  const challenge = await getChallenge();
  return request(app).post('/api/devices/enrol').send({ challenge, signature: device.sign(challenge), ...body });
}

async function signIn(device, deviceId, { email = USERS.staff.email, pin = '482915' } = {}) {
  const challenge = await getChallenge();
  return request(app).post('/api/devices/sign-in').send({ email, pin, deviceId, challenge, signature: device.sign(challenge) });
}

/**
 * The seeded staff member sets up a new device with their password.
 */
async function enrolStaffDevice(device = makeDevice(), pin = '482915') {
  const res = await enrol(device, { email: USERS.staff.email, password: USERS.staff.password, pin, publicKey: device.publicKey, deviceName: 'Kitchen tablet' });
  return { device, id: res.body.device?.id, res };
}

async function approve(deviceId) {
  return asAdmin.post(`/api/devices/${deviceId}/approve`);
}

describe('setting up a device', () => {
  it('with a password: registers the device as pending for the staff member’s school, with a hashed PIN', async () => {
    const { id, res } = await enrolStaffDevice();

    expect(res.status).toBe(201);
    expect(res.body.device).toMatchObject({ status: 'pending', schoolId: SCHOOL_ID, name: 'Kitchen tablet' });
    const stored = await pool.query('SELECT public_key, enrolled_by FROM devices WHERE id = $1', [id]);
    expect(stored.rows[0].public_key).toEqual({ kty: 'EC', crv: 'P-256', x: expect.any(String), y: expect.any(String) });
    expect(stored.rows[0].enrolled_by).toBe(USERS.staff.id);
    const link = await pool.query('SELECT pin_hash FROM device_users WHERE device_id = $1', [id]);
    expect(link.rows[0].pin_hash).toMatch(/^\$2[aby]\$10\$/);
  });

  it('with an activation code: sets the new staff member’s password and spends the code', async () => {
    const created = (await asAdmin.post('/api/users').send({ name: 'Peter Otieno', email: 'peter@example.org', role: 'school_staff', schoolId: SCHOOL_ID })).body;
    const device = makeDevice();
    const body = { email: 'peter@example.org', activationCode: created.activationCode.toLowerCase(), newPassword: 'peters-own-password', pin: '739104', publicKey: device.publicKey, deviceName: 'Store phone' };

    const res = await enrol(device, body);
    const again = await enrol(device, body);

    expect(res.status).toBe(201);
    expect(again.status).toBe(401);
    const user = await pool.query('SELECT password_changed_at FROM users WHERE id = $1', [created.user.id]);
    expect(user.rows[0].password_changed_at).not.toBeNull();
  });

  it('refuses an expired activation code', async () => {
    const created = (await asAdmin.post('/api/users').send({ name: 'Peter Otieno', email: 'peter@example.org', role: 'school_staff', schoolId: SCHOOL_ID })).body;
    await pool.query("UPDATE activation_codes SET expires_at = NOW() - interval '1 minute'");
    const device = makeDevice();

    const res = await enrol(device, { email: 'peter@example.org', activationCode: created.activationCode, newPassword: 'peters-own-password', pin: '739104', publicKey: device.publicKey, deviceName: 'Store phone' });

    expect(res.status).toBe(401);
  });

  it.each([
    ['a wrong password', { password: 'wrong-password' }],
    ['an unknown email', { email: 'nobody@example.org' }],
    ['an administrator’s account', { email: USERS.admin.email, password: USERS.admin.password }],
  ])('refuses %s with the same message', async (_, overrides) => {
    const device = makeDevice();

    const res = await enrol(device, { email: USERS.staff.email, password: USERS.staff.password, pin: '482915', publicKey: device.publicKey, deviceName: 'Tablet', ...overrides });

    expect(res).toMatchObject({ status: 401, body: { error: 'Those details could not be used to set up this device' } });
  });

  it.each([
    ['a weak PIN', { pin: '123456' }],
    ['a PIN that is not 6 digits', { pin: '12345' }],
    ['no device name', { deviceName: ' ' }],
  ])('refuses %s', async (_, overrides) => {
    const device = makeDevice();

    const res = await enrol(device, { email: USERS.staff.email, password: USERS.staff.password, pin: '482915', publicKey: device.publicKey, deviceName: 'Tablet', ...overrides });

    expect(res.status).toBe(400);
  });

  it('refuses a key with private parts, and a signature from a different key', async () => {
    const device = makeDevice();
    const other = makeDevice();
    const base = { email: USERS.staff.email, password: USERS.staff.password, pin: '482915', deviceName: 'Tablet' };

    const withPrivate = await enrol(device, { ...base, publicKey: { ...device.publicKey, d: 'secret' } });
    const wrongSigner = await enrol(other, { ...base, publicKey: device.publicKey });

    expect(withPrivate.status).toBe(400);
    expect(wrongSigner.status).toBe(400);
    expect((await pool.query("SELECT count(*)::int AS n FROM devices WHERE name = 'Tablet'")).rows[0].n).toBe(0);
  });

  it('uses each challenge once', async () => {
    const device = makeDevice();
    const challenge = await getChallenge();
    const body = { challenge, signature: device.sign(challenge), email: USERS.staff.email, password: USERS.staff.password, pin: '482915', publicKey: device.publicKey, deviceName: 'Tablet' };
    await request(app).post('/api/devices/enrol').send(body);

    const replay = await request(app).post('/api/devices/enrol').send(body);

    expect(replay.status).toBe(400);
  });

  it('lets a second staff member join an existing device, but not staff from another school', async () => {
    const { device, id } = await enrolStaffDevice();
    await approve(id);
    await asAdmin.post('/api/users').send({ name: 'Peter Otieno', email: 'peter@example.org', role: 'admin', password: 'temporary-password' });
    await pool.query("INSERT INTO schools (id, name, location) VALUES ($1, 'Second School', 'Elsewhere')", [OTHER_SCHOOL_ID]);
    await pool.query("UPDATE users SET role = 'school_staff', school_id = $1 WHERE email = 'peter@example.org'", [OTHER_SCHOOL_ID]);

    const otherSchool = await enrol(device, { email: 'peter@example.org', password: 'temporary-password', pin: '739104', deviceId: id });
    await pool.query('UPDATE users SET school_id = $1 WHERE email = $2', [SCHOOL_ID, 'peter@example.org']);
    const sameSchool = await enrol(device, { email: 'peter@example.org', password: 'temporary-password', pin: '739104', deviceId: id });

    expect(otherSchool.status).toBe(403);
    expect(sameSchool.status).toBe(201);
    expect(sameSchool.body.device.status).toBe('approved');
  });
});

describe('signing in on a device', () => {
  it('is refused while the device waits for approval', async () => {
    const { device, id } = await enrolStaffDevice();

    const res = await signIn(device, id);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ devicePending: true });
  });

  it('works on an approved device and gives a session tied to the device and school', async () => {
    const { device, id } = await enrolStaffDevice();
    await approve(id);

    const res = await signIn(device, id);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: USERS.staff.id, role: 'school_staff', schoolId: SCHOOL_ID, deviceId: id });
    expect(res.body.device).toMatchObject({ id, status: 'approved' });
    const schools = await request(app).get('/api/schools').set('Authorization', `Bearer ${res.body.token}`);
    expect(schools.body.schools.map((s) => s.id)).toEqual([SCHOOL_ID]);
  });

  it('needs the device’s own signature', async () => {
    const { id } = await enrolStaffDevice();
    await approve(id);

    expect((await signIn(makeDevice(), id)).status).toBe(401);
  });

  it('counts wrong PINs, locks after 5, and an administrator can unlock it', async () => {
    const { device, id } = await enrolStaffDevice();
    await approve(id);

    const first = await signIn(device, id, { pin: '111222' });
    for (let i = 0; i < 3; i += 1) await signIn(device, id, { pin: '111222' });
    const fifth = await signIn(device, id, { pin: '111222' });
    const rightPinWhileLocked = await signIn(device, id);
    await asAdmin.post(`/api/devices/${id}/users/${USERS.staff.id}/unlock`);
    const afterUnlock = await signIn(device, id);

    expect(first).toMatchObject({ status: 401, body: { attemptsLeft: 4 } });
    expect(fifth).toMatchObject({ status: 423, body: { locked: true } });
    expect(rightPinWhileLocked.status).toBe(423);
    expect(afterUnlock.status).toBe(200);
  });

  it('gives the same message for an unknown email', async () => {
    const { device, id } = await enrolStaffDevice();
    await approve(id);

    const res = await signIn(device, id, { email: 'nobody@example.org' });

    expect(res).toMatchObject({ status: 401, body: { error: 'Email or PIN is not correct' } });
  });
});

describe('revoking a device', () => {
  it('ends its sessions and stops sign-in and set-up on it', async () => {
    const { device, id } = await enrolStaffDevice();
    await approve(id);
    const session = (await signIn(device, id)).body;

    await asAdmin.post(`/api/devices/${id}/revoke`);

    const withSession = await request(app).get('/api/schools').set('Authorization', `Bearer ${session.token}`);
    expect(withSession.status).toBe(401);
    expect(withSession.body).toMatchObject({ deviceRevoked: true });
    expect((await signIn(device, id)).body).toMatchObject({ deviceRevoked: true });
    expect((await enrol(device, { email: USERS.staff.email, password: USERS.staff.password, pin: '482915', deviceId: id })).status).toBe(409);
    expect((await approve(id)).status).toBe(400);
  });
});

describe('managing devices', () => {
  it('lists devices with their school, status and staff, for administrators only', async () => {
    const { id } = await enrolStaffDevice();

    const res = await asAdmin.get('/api/devices');

    expect(res.status).toBe(200);
    expect(res.body.devices.find((d) => d.id === id)).toMatchObject({
      status: 'pending', schoolName: 'Demo Primary School', enrolledBy: USERS.staff.name,
      staff: [{ userId: USERS.staff.id, locked: false }],
    });
    expect((await asStaff.get('/api/devices')).status).toBe(403);
    expect((await request(app).get('/api/devices')).status).toBe(401);
  });

  it('returns 404 for unknown devices', async () => {
    expect((await asAdmin.post(`/api/devices/${MISSING_ID}/approve`)).status).toBe(404);
    expect((await asAdmin.post('/api/devices/not-a-uuid/revoke')).status).toBe(404);
  });
});

describe('school staff stay within their school', () => {
  beforeEach(async () => {
    await pool.query("INSERT INTO schools (id, name, location) VALUES ($1, 'Second School', 'Elsewhere')", [OTHER_SCHOOL_ID]);
  });

  it('can record for their own school but not another', async () => {
    const own = await asStaff.post('/api/attendance').send({ school_id: SCHOOL_ID, attendance_date: '07-10-2026', total_registered: 100, total_present: 90, total_absent: 10 });
    const other = await asStaff.post('/api/attendance').send({ school_id: OTHER_SCHOOL_ID, attendance_date: '07-10-2026', total_registered: 100, total_present: 90, total_absent: 10 });

    expect(own.status).toBe(201);
    expect(other.status).toBe(403);
  });

  it('cannot sync records for another school', async () => {
    const res = await asStaff.post('/api/sync').send({
      clientId: 'device-a',
      operations: [syncOperation('op-x', 'attendance', 'create', attendancePayload({ schoolId: OTHER_SCHOOL_ID }), 0)],
    });

    expect(res.status).toBe(400);
  });

  it('only see their own school', async () => {
    const list = await asStaff.get('/api/schools');

    expect(list.body.schools.map((s) => s.id)).toEqual([SCHOOL_ID]);
    expect((await asStaff.get(`/api/schools/${OTHER_SCHOOL_ID}`)).status).toBe(404);
    expect((await asAdmin.get('/api/schools')).body.schools).toHaveLength(2);
  });

  it('need a session from an approved device', async () => {
    await pool.query("UPDATE devices SET status = 'pending'");

    expect((await asStaff.get('/api/schools')).status).toBe(401);
  });
});
