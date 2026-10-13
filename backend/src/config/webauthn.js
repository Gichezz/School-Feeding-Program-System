/**
 * Passkey (WebAuthn) settings.
 *
 * WEBAUTHN_RP_ID      the domain passkeys belong to: "localhost" in development, the
 *                     server's domain in production. Passkeys made for one domain do not
 *                     work on another.
 * WEBAUTHN_ORIGINS    comma-separated browser origins allowed to use them, e.g.
 *                     "https://lishe.example.org" (defaults to FRONTEND_URL)
 * WEBAUTHN_RP_NAME    the name shown by the device when it asks for a passkey
 */

function getWebAuthnConfig() {
  const origins = (process.env.WEBAUTHN_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return {
    rpID: process.env.WEBAUTHN_RP_ID || 'localhost',
    rpName: process.env.WEBAUTHN_RP_NAME || 'Lishe',
    origins,
  };
}

module.exports = {
  getWebAuthnConfig,
};
