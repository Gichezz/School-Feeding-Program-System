/**
 * Validation rules for user accounts. Each function returns an error message,
 * or null when the value is valid.
 */

const ROLES = ['admin', 'school_staff'];
const MIN_PASSWORD_LENGTH = 10;
// bcrypt only uses the first 72 bytes of a password
const MAX_PASSWORD_BYTES = 72;
const MAX_NAME_LENGTH = 100;
// Same rule as the users_email_format constraint in database/schema.sql
const EMAIL_FORMAT = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function nameError(name) {
  if (typeof name !== 'string' || !name.trim()) return 'Enter the name';
  if (name.trim().length > MAX_NAME_LENGTH) return `The name must be ${MAX_NAME_LENGTH} characters or fewer`;
  return null;
}

function emailError(email) {
  if (typeof email !== 'string' || !email.trim()) return 'Enter the email address';
  if (!EMAIL_FORMAT.test(email.trim())) return 'Enter a valid email address, like name@school.org';
  return null;
}

function roleError(role) {
  return ROLES.includes(role) ? null : `Role must be one of: ${ROLES.join(', ')}`;
}

function passwordError(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `The password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return `The password must be ${MAX_PASSWORD_BYTES} bytes or fewer`;
  }
  return null;
}

/**
 * A staff PIN: exactly 6 digits, not one repeated digit (000000) and not a straight
 * run up or down (123456, 654321), which are the first guesses anyone tries.
 */
function pinError(pin) {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) return 'The PIN must be exactly 6 digits';
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]);
  if (steps.every((s) => s === 0)) return 'Choose a PIN that is not one digit repeated';
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return 'Choose a PIN that is not a run of digits like 123456';
  return null;
}

/**
 * Emails are compared and stored in lower case, so one address has one account.
 */
function normaliseEmail(email) {
  return email.trim().toLowerCase();
}

module.exports = {
  ROLES,
  MIN_PASSWORD_LENGTH,
  nameError,
  emailError,
  roleError,
  passwordError,
  pinError,
  normaliseEmail,
};
