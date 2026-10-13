/**
 * The signed-in user's session, kept in localStorage so the app still knows who is
 * signed in when it is reopened offline. An expired session still allows offline
 * recording; only server requests (including sync) need a valid one.
 */

const STORAGE_KEY = 'sfs_session';
export const SESSION_CHANGED_EVENT = 'session:changed';
export const SESSION_EXPIRED_EVENT = 'session:expired';

function notify(eventName) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(eventName));
  }
}

/**
 * @returns {{ token: string, expiresAt: string, user: { id, name, email, role } } | null}
 */
export function getSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  notify(SESSION_CHANGED_EVENT);
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
  notify(SESSION_CHANGED_EVENT);
}

export function isSessionValid(session = getSession(), now = Date.now()) {
  return Boolean(session?.token) && new Date(session.expiresAt).getTime() > now;
}

/**
 * Called when the server rejects the session (401), e.g. it expired on the server side.
 * Keeps the user details so the app can still show who was signed in.
 * reason: why it ended, when the app should say more than "expired" (e.g. 'deviceRevoked').
 */
export function markSessionExpired(reason) {
  const session = getSession();
  if (session) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...session, expiresAt: new Date(0).toISOString(), ...(reason && { endedReason: reason }) }));
  }
  notify(SESSION_EXPIRED_EVENT);
}

export function hasRole(role, session = getSession()) {
  return session?.user?.role === role;
}
