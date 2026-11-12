import { enrolDevice, getDeviceApprovalStatus, getDeviceChallenge, signInOnDevice } from '../../services/api';
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
    // The server no longer knows this device, or its set-up expired; set it up again as a new one
    if (error.data?.deviceRevoked || error.data?.deviceExpired) await clearDeviceIdentity();
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
    if (error.data?.deviceRevoked || error.data?.deviceExpired) await clearDeviceIdentity();
    throw error;
  }
}

/**
 * Ask the server whether this device has been approved yet, and keep the answer.
 * A device the server has removed (or no longer knows), or whose set-up expired before
 * it was approved, forgets its identity, so it can be set up again as a new device.
 * Returns the status ('expired' too), or null when this is not a school device.
 */
export async function checkDeviceApproval() {
  const identity = await getDeviceIdentity();
  if (!identity) return null;
  let status;
  try {
    ({ status } = await getDeviceApprovalStatus(identity.deviceId));
  } catch (error) {
    if (error.status === 404) {
      await clearDeviceIdentity();
      return 'revoked';
    }
    // The server no longer answers for an expired set-up (410)
    if (error.status === 410) {
      await clearDeviceIdentity();
      return 'expired';
    }
    throw error;
  }
  if (status === 'revoked') await clearDeviceIdentity();
  else if (status !== identity.status) await updateDeviceStatus(status);
  return status;
}
