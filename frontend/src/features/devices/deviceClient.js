import { enrolDevice, getDeviceChallenge, signInOnDevice } from '../../services/api';
import {
  clearDeviceIdentity,
  createDeviceKeys,
  getDeviceIdentity,
  saveDeviceIdentity,
  signChallenge,
  updateDeviceStatus,
} from './deviceIdentity';
import { rememberForOffline } from './offlineSignIn';

/**
 * Setting up a school device and signing staff in on it (#60). Every request carries a
 * fresh server challenge signed with the device's private key.
 */

/**
 * Set up staff sign-in on this device.
 * credentials: { email, pin, activationCode + newPassword } or { email, pin, password }
 * deviceName: needed only when this browser is not yet a school device.
 * Returns the server's { device, user }.
 */
export async function setUpDevice(credentials, deviceName) {
  const existing = await getDeviceIdentity();
  const keys = existing ? null : await createDeviceKeys();
  const { challenge } = await getDeviceChallenge();
  const signature = await signChallenge(existing ? existing.privateKey : keys.privateKey, challenge);

  let result;
  try {
    result = await enrolDevice({
      ...credentials,
      challenge,
      signature,
      ...(existing ? { deviceId: existing.deviceId } : { publicKey: keys.publicJwk, deviceName }),
    });
  } catch (error) {
    // The server no longer knows this device; set it up again as a new one
    if (error.data?.deviceRevoked) await clearDeviceIdentity();
    throw error;
  }

  const { device } = result;
  if (existing) {
    await updateDeviceStatus(device.status);
  } else {
    await saveDeviceIdentity({
      deviceId: device.id,
      name: device.name,
      schoolId: device.schoolId,
      status: device.status,
      privateKey: keys.privateKey,
    });
  }
  return result;
}

/**
 * Sign a staff member in with their email and PIN on this device. Returns the session.
 */
export async function signInWithPin(email, pin) {
  const identity = await getDeviceIdentity();
  if (!identity) throw new Error('This browser is not set up as a school device yet.');
  const { challenge } = await getDeviceChallenge();
  const signature = await signChallenge(identity.privateKey, challenge);
  try {
    const session = await signInOnDevice({ email, pin, deviceId: identity.deviceId, challenge, signature });
    if (identity.status !== 'approved') await updateDeviceStatus('approved');
    // So this person can sign in here without a connection for the next 7 days (#61)
    const { device, ...sessionOnly } = session;
    await rememberForOffline(sessionOnly, pin, identity.deviceId).catch(() => {});
    return session;
  } catch (error) {
    if (error.data?.deviceRevoked) await clearDeviceIdentity();
    throw error;
  }
}
