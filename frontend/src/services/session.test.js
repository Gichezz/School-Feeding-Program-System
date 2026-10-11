import { describe, expect, it, vi } from 'vitest';
import {
  getSession,
  saveSession,
  clearSession,
  isSessionValid,
  markSessionExpired,
  hasRole,
  SESSION_CHANGED_EVENT,
  SESSION_EXPIRED_EVENT,
} from './session';

const user = { id: 'u-1', name: 'School Feeding Officer', email: 'staff@demo-school.local', role: 'school_staff' };
const inOneHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

describe('session store', () => {
  it('saves and reads back the session', () => {
    saveSession({ token: 'abc', expiresAt: inOneHour(), user });

    expect(getSession()).toMatchObject({ token: 'abc', user });
  });

  it('returns null when nobody has signed in', () => {
    expect(getSession()).toBeNull();
    expect(isSessionValid()).toBe(false);
  });

  it('treats a session as valid only until it expires', () => {
    const session = { token: 'abc', expiresAt: '2026-10-12T10:00:00.000Z', user };

    expect(isSessionValid(session, Date.parse('2026-10-12T09:59:59Z'))).toBe(true);
    expect(isSessionValid(session, Date.parse('2026-10-12T10:00:00Z'))).toBe(false);
  });

  it('keeps the user but invalidates the session when the server rejects it', () => {
    saveSession({ token: 'abc', expiresAt: inOneHour(), user });

    markSessionExpired();

    expect(isSessionValid()).toBe(false);
    expect(getSession().user).toEqual(user);
  });

  it('clears the session on sign out', () => {
    saveSession({ token: 'abc', expiresAt: inOneHour(), user });

    clearSession();

    expect(getSession()).toBeNull();
  });

  it('checks the signed-in role', () => {
    saveSession({ token: 'abc', expiresAt: inOneHour(), user });

    expect(hasRole('school_staff')).toBe(true);
    expect(hasRole('admin')).toBe(false);
  });

  it('notifies the app when the session changes or expires', () => {
    const listener = vi.fn();
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    target.addEventListener(SESSION_CHANGED_EVENT, listener);
    target.addEventListener(SESSION_EXPIRED_EVENT, listener);

    saveSession({ token: 'abc', expiresAt: inOneHour(), user });
    markSessionExpired();
    clearSession();

    expect(listener).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });
});
