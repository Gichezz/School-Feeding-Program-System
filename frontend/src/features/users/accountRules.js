/**
 * The same account rules the server applies (backend/src/validation/users.js),
 * checked on the device for immediate feedback.
 */

export const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_BYTES = 72;
const EMAIL_FORMAT = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export const ROLE_OPTIONS = [
  { value: 'school_staff', label: 'School staff' },
  { value: 'admin', label: 'Administrator' },
];

export function passwordError(password) {
  if (!password) return 'Enter a password';
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters`;
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return 'Use a shorter password (72 bytes at most)';
  return null;
}

/**
 * Errors for the new user form, keyed by field.
 */
export function newUserErrors({ name, email, password }) {
  const errors = {};
  if (!name?.trim()) errors.name = 'Enter their name';
  else if (name.trim().length > 100) errors.name = 'Use 100 characters or fewer';
  if (!email?.trim()) errors.email = 'Enter their email address';
  else if (!EMAIL_FORMAT.test(email.trim())) errors.email = 'Enter a valid email address, like name@school.org';
  const weak = passwordError(password);
  if (weak) errors.password = weak;
  return errors;
}

/**
 * Errors for the change password form, keyed by field.
 */
export function changePasswordErrors({ currentPassword, newPassword, confirmPassword }) {
  const errors = {};
  if (!currentPassword) errors.currentPassword = 'Enter your current password';
  const weak = passwordError(newPassword);
  if (weak) errors.newPassword = weak;
  else if (newPassword === currentPassword) errors.newPassword = 'Choose a password different from your current one';
  if (!errors.newPassword && confirmPassword !== newPassword) errors.confirmPassword = 'The passwords do not match';
  return errors;
}
