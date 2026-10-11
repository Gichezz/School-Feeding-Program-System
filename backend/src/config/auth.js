/**
 * Authentication settings.
 * JWT_SECRET signs session tokens and must be set (never committed); the server
 * refuses to start without it.
 */

const DEFAULT_EXPIRES_IN = '7d';
const MIN_SECRET_LENGTH = 32;

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  // The placeholder from .env.example is public, so it must never be used to sign tokens
  if (!secret || secret.length < MIN_SECRET_LENGTH || secret.startsWith('replace-with')) {
    throw new Error(`JWT_SECRET must be set to a random string of at least ${MIN_SECRET_LENGTH} characters`);
  }
  return secret;
}

function getJwtExpiresIn() {
  return process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRES_IN;
}

module.exports = {
  getJwtSecret,
  getJwtExpiresIn,
};
