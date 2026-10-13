import db from '../../db/database';
import { forgetAllOfflineUsers } from './offlineSignIn';

/**
 * This school device's identity (#60).
 *
 * The device creates a P-256 key pair with WebCrypto. The private key is created
 * non-extractable: the app can use it to sign, but neither the app nor anyone reading
 * IndexedDB can export it. The browser stores the CryptoKey object itself in IndexedDB.
 * Only the public key is sent to the server when the device is set up.
 */

const KEY = 'device';
const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' };

function toBase64Url(buffer) {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A new key pair whose private key cannot be exported. Returns { privateKey, publicJwk }.
 */
export async function createDeviceKeys() {
  const pair = await crypto.subtle.generateKey(ALGORITHM, false, ['sign', 'verify']);
  const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { privateKey: pair.privateKey, publicJwk: { kty, crv, x, y } };
}

/**
 * Sign a server challenge (ECDSA P-256 / SHA-256). Returns the raw signature as base64url.
 */
export async function signChallenge(privateKey, challenge) {
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(challenge));
  return toBase64Url(signature);
}

/**
 * { deviceId, name, schoolId, schoolName, status, privateKey } or null when this
 * browser has not been set up as a school device.
 */
export async function getDeviceIdentity() {
  try {
    return (await db.deviceIdentity.get(KEY)) || null;
  } catch {
    return null;
  }
}

export async function saveDeviceIdentity(identity) {
  await db.deviceIdentity.put({ ...identity, key: KEY });
}

export async function updateDeviceStatus(status) {
  await db.deviceIdentity.update(KEY, { status });
}

/**
 * Forget this device's identity, e.g. after an administrator removed the device, along
 * with everyone's offline sign-in on it. Records saved on the device are not touched.
 */
export async function clearDeviceIdentity() {
  await db.deviceIdentity.delete(KEY);
  await forgetAllOfflineUsers();
}
