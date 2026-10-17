/**
 * Display and input helpers for authenticator app set-up and sign-in (#63).
 */

export const SECOND_FACTOR_CHANGED_EVENT = 'lishe:second-factor-changed';

/**
 * A base32 secret in groups of four, easier to type into an app by hand.
 */
export function formatSecret(secret) {
  return String(secret || '').replace(/(.{4})(?=.)/g, '$1 ');
}

/**
 * What the person typed as a 6-digit code: digits only, at most 6.
 */
export function normaliseCode(input) {
  return String(input || '').replace(/\D/g, '').slice(0, 6);
}

export function isCompleteCode(input) {
  return /^\d{6}$/.test(String(input || ''));
}
