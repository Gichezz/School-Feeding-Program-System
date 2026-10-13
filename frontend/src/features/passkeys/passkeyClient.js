import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import {
  getPasskeyLoginOptions,
  getPasskeyRegistrationOptions,
  verifyPasskeyLogin,
  verifyPasskeyRegistration,
} from '../../services/api';
import { getSession, saveSession } from '../../services/session';

/**
 * Browser side of passkey sign-in (#57). The device creates and keeps the private key;
 * the server only sees the public key and signed challenges.
 */

export function passkeysSupported() {
  return browserSupportsWebAuthn();
}

/**
 * A plain-language message for a failed passkey step.
 */
export function passkeyErrorMessage(error) {
  const name = error?.cause?.name || error?.name;
  if (name === 'NotAllowedError' || name === 'AbortError' || error?.code === 'ERROR_CEREMONY_ABORTED') {
    return 'The passkey request was cancelled or timed out. Try again when you are ready.';
  }
  if (error?.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
    return 'This device already has a passkey for your account.';
  }
  if (error?.code === 'ERROR_INVALID_DOMAIN' || error?.code === 'ERROR_INVALID_RP_ID') {
    return 'Passkeys are not set up for this web address. Ask whoever runs Lishe to check the passkey settings.';
  }
  if (error?.status) return error.message;
  return 'Your device could not use a passkey. Check that it has a screen lock, fingerprint or face unlock set up.';
}

/**
 * Sign in with a passkey held by this device (or a nearby phone). Returns the session.
 */
export async function signInWithPasskey() {
  const optionsJSON = await getPasskeyLoginOptions();
  const response = await startAuthentication({ optionsJSON });
  return verifyPasskeyLogin(response);
}

/**
 * Create a passkey on this device for the signed-in administrator.
 * Returns { passkey, recoveryCodes? }.
 */
export async function addPasskey(name) {
  const optionsJSON = await getPasskeyRegistrationOptions();
  const response = await startRegistration({ optionsJSON });
  const result = await verifyPasskeyRegistration(response, name);
  // The account now has a passkey, so stop asking for one
  const session = getSession();
  if (session?.user?.needsPasskey) saveSession({ ...session, user: { ...session.user, needsPasskey: false } });
  return result;
}

/**
 * A suggested name for a passkey made on this device.
 */
export function suggestedPasskeyName(userAgent = navigator.userAgent) {
  if (/Android/i.test(userAgent)) return 'Android phone';
  if (/iPhone|iPad/i.test(userAgent)) return 'iPhone or iPad';
  if (/Windows/i.test(userAgent)) return 'Windows computer';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'Mac';
  return 'This device';
}
