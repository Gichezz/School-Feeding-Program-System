import { describe, expect, it } from 'vitest';
import db from '../../db/database';
import { forgetOfflineUser, rememberForOffline, signInOffline } from './offlineSignIn';

// Few PBKDF2 rounds keep the tests fast; the app uses 600,000
const FAST = { iterations: 1000 };
const DAY = 24 * 60 * 60 * 1000;
const signedInAt = new Date('2026-10-13T08:00:00Z');
const session = {
  token: 'token-from-last-online-sign-in',
  expiresAt: '2026-10-20T08:00:00.000Z',
  user: { id: 'user-peter', name: 'Peter Otieno', email: 'Peter@Example.org', role: 'school_staff', schoolId: 'school-1', deviceId: 'device-1' },
};

async function remember() {
  await rememberForOffline(session, '482915', 'device-1', { ...FAST, now: signedInAt });
}

describe('remembering a staff member for offline sign-in', () => {
  it('stores a salted PIN hash, never the PIN', async () => {
    await remember();

    const stored = await db.offlineUsers.get('user-peter');
    expect(stored).toMatchObject({ email: 'peter@example.org', deviceId: 'device-1', failedAttempts: 0, lastOnlineAt: signedInAt.toISOString() });
    expect(JSON.stringify(stored)).not.toContain('482915');
    expect(stored.pinHash).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('gives each sign-in a fresh salt', async () => {
    await remember();
    const first = await db.offlineUsers.get('user-peter');
    await remember();
    const second = await db.offlineUsers.get('user-peter');

    expect(second.salt).not.toBe(first.salt);
    expect(second.pinHash).not.toBe(first.pinHash);
  });

  it('is only for school staff', async () => {
    await rememberForOffline({ ...session, user: { ...session.user, id: 'admin-1', role: 'admin' } }, '482915', 'device-1', FAST);

    expect(await db.offlineUsers.get('admin-1')).toBeUndefined();
  });
});

describe('signing in offline', () => {
  it('works with the right PIN within 7 days, returning the last session marked offline', async () => {
    await remember();

    const result = await signInOffline('peter@example.org', '482915', 'device-1', { now: new Date(signedInAt.getTime() + 6 * DAY) });

    expect(result).toMatchObject({ token: session.token, user: { id: 'user-peter' }, offline: true });
  });

  it('is refused after 7 days without an online sign-in', async () => {
    await remember();

    await expect(signInOffline('peter@example.org', '482915', 'device-1', { now: new Date(signedInAt.getTime() + 7 * DAY + 1000) }))
      .rejects.toMatchObject({ code: 'expired' });
  });

  it('counts wrong PINs and locks after 5, even for the right PIN', async () => {
    await remember();
    const now = { now: signedInAt };

    await expect(signInOffline('peter@example.org', '111222', 'device-1', now)).rejects.toMatchObject({ code: 'wrong', message: expect.stringMatching(/4 tries left/) });
    for (let i = 0; i < 3; i += 1) await signInOffline('peter@example.org', '111222', 'device-1', now).catch(() => {});
    await expect(signInOffline('peter@example.org', '111222', 'device-1', now)).rejects.toMatchObject({ code: 'locked' });
    await expect(signInOffline('peter@example.org', '482915', 'device-1', now)).rejects.toMatchObject({ code: 'locked' });
  });

  it('is unlocked by the next online sign-in', async () => {
    await remember();
    for (let i = 0; i < 5; i += 1) await signInOffline('peter@example.org', '111222', 'device-1', { now: signedInAt }).catch(() => {});

    await remember();

    await expect(signInOffline('peter@example.org', '482915', 'device-1', { now: signedInAt })).resolves.toMatchObject({ offline: true });
  });

  it('only works on the device where they signed in, and only for people who have', async () => {
    await remember();

    await expect(signInOffline('peter@example.org', '482915', 'another-device', { now: signedInAt })).rejects.toMatchObject({ code: 'unknown' });
    await expect(signInOffline('mary@example.org', '482915', 'device-1', { now: signedInAt })).rejects.toMatchObject({ code: 'unknown' });
  });

  it('stops working once the device forgets the person', async () => {
    await remember();

    await forgetOfflineUser('user-peter');

    await expect(signInOffline('peter@example.org', '482915', 'device-1', { now: signedInAt })).rejects.toMatchObject({ code: 'unknown' });
  });
});
