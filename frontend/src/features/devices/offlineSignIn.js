import db from '../../db/database';

/**
 * Offline sign-in on an enrolled school device (#61), following the pattern of DHIS2
 * Android Capture and CommCare.
 *
 * After each successful online PIN sign-in, the device keeps what it needs to check that
 * staff member's PIN without the server: a PBKDF2 hash of the PIN with a random salt
 * (never the PIN itself), when they last signed in online, and their last session.
 * Offline, the same email + PIN signs them in on this device only, for up to 7 days
 * after their last online sign-in, and 5 wrong PINs lock offline sign-in until they sign
 * in online again.
 *
 * Because the check runs on the device, offline sign-in is lower assurance than online
 * sign-in. The server stays the authority: it re-checks every record and account when
 * the device syncs (see backend/src/services/captureCheck.js).
 */

export const OFFLINE_WINDOW_DAYS = 7;
export const MAX_OFFLINE_ATTEMPTS = 5;
// OWASP's recommendation for PBKDF2-HMAC-SHA256 (2023)
export const PBKDF2_ITERATIONS = 600000;
const DAY_MS = 24 * 60 * 60 * 1000;

function toBase64(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

async function hashPin(pin, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toBase64(bits);
}

/**
 * Compare without stopping at the first difference.
 */
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Called after a successful online PIN sign-in on this device. Only school staff can
 * sign in offline.
 */
export async function rememberForOffline(session, pin, deviceId, { iterations = PBKDF2_ITERATIONS, now = new Date() } = {}) {
  const { user } = session;
  if (user?.role !== 'school_staff') return;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await db.offlineUsers.put({
    userId: user.id,
    email: user.email.toLowerCase(),
    deviceId,
    salt: toBase64(salt),
    iterations,
    pinHash: await hashPin(pin, salt, iterations),
    lastOnlineAt: now.toISOString(),
    failedAttempts: 0,
    session,
  });
}

export class OfflineSignInError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/**
 * Sign in on this device without the server. Returns the session to use offline (marked
 * offline: true), or throws OfflineSignInError with a plain-language message.
 */
export async function signInOffline(email, pin, deviceId, { now = new Date() } = {}) {
  const entry = await db.offlineUsers.where('email').equals(String(email).trim().toLowerCase()).first();
  if (!entry || entry.deviceId !== deviceId) {
    throw new OfflineSignInError('You have not signed in on this device yet. Connect to the internet and sign in once first.', 'unknown');
  }
  if (entry.failedAttempts >= MAX_OFFLINE_ATTEMPTS) {
    throw new OfflineSignInError('Offline sign-in is locked after too many wrong PINs. Connect to the internet and sign in to unlock it.', 'locked');
  }
  if (now - new Date(entry.lastOnlineAt) > OFFLINE_WINDOW_DAYS * DAY_MS) {
    throw new OfflineSignInError(`It has been more than ${OFFLINE_WINDOW_DAYS} days since you signed in online on this device. Connect to the internet and sign in.`, 'expired');
  }

  const hash = await hashPin(pin, fromBase64(entry.salt), entry.iterations);
  if (!sameText(hash, entry.pinHash)) {
    const failedAttempts = entry.failedAttempts + 1;
    await db.offlineUsers.update(entry.userId, { failedAttempts });
    const left = MAX_OFFLINE_ATTEMPTS - failedAttempts;
    if (left <= 0) {
      throw new OfflineSignInError('Offline sign-in is locked after too many wrong PINs. Connect to the internet and sign in to unlock it.', 'locked');
    }
    throw new OfflineSignInError(`Email or PIN is not correct. ${left === 1 ? '1 try' : `${left} tries`} left before offline sign-in locks.`, 'wrong');
  }

  await db.offlineUsers.update(entry.userId, { failedAttempts: 0 });
  return { ...entry.session, offline: true, offlineSignInAt: now.toISOString() };
}

/**
 * Forget one person's offline sign-in on this device (deactivated, password reset).
 */
export async function forgetOfflineUser(userId) {
  await db.offlineUsers.delete(userId);
}

export async function forgetAllOfflineUsers() {
  await db.offlineUsers.clear();
}
