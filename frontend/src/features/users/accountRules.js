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
 * A staff PIN: exactly 6 digits, not one repeated digit and not a straight run.
 */
export function pinError(pin) {
  if (!pin) return 'Enter a 6-digit PIN';
  if (!/^\d{6}$/.test(pin)) return 'The PIN must be exactly 6 digits';
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]);
  if (steps.every((s) => s === 0)) return 'Choose a PIN that is not one digit repeated';
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return 'Choose a PIN that is not a run of digits like 123456';
  return null;
}

/**
 * Errors for setting up a school device, keyed by field.
 * values: { email, method: 'code' | 'password', activationCode, newPassword, confirmPassword,
 *           password, pin, confirmPin, deviceName, needsDeviceName }
 */
export function deviceSetupErrors(values) {
  const errors = {};
  if (!values.email?.trim()) errors.email = 'Enter your email address';
  else if (!EMAIL_FORMAT.test(values.email.trim())) errors.email = 'Enter a valid email address, like name@school.org';
  if (values.method === 'code') {
    if (!values.activationCode?.trim()) errors.activationCode = 'Enter the activation code from your administrator';
    const weak = passwordError(values.newPassword);
    if (weak) errors.newPassword = weak;
    else if (values.confirmPassword !== values.newPassword) errors.confirmPassword = 'The passwords do not match';
  } else if (!values.password) {
    errors.password = 'Enter your password';
  }
  const badPin = pinError(values.pin);
  if (badPin) errors.pin = badPin;
  else if (values.confirmPin !== values.pin) errors.confirmPin = 'The PINs do not match';
  if (values.needsDeviceName && !values.deviceName?.trim()) errors.deviceName = 'Give this device a name, e.g. Kitchen tablet';
  return errors;
}

/**
 * Errors for the new user form, keyed by field.
 */
export function newUserErrors({ name, email, password, role = 'admin', schoolId }) {
  const errors = {};
  if (!name?.trim()) errors.name = 'Enter their name';
  else if (name.trim().length > 100) errors.name = 'Use 100 characters or fewer';
  if (!email?.trim()) errors.email = 'Enter their email address';
  else if (!EMAIL_FORMAT.test(email.trim())) errors.email = 'Enter a valid email address, like name@school.org';
  if (role === 'school_staff') {
    if (!schoolId) errors.schoolId = 'Choose their school';
  } else {
    const weak = passwordError(password);
    if (weak) errors.password = weak;
  }
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
