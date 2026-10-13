import { describe, expect, it } from 'vitest';
import { changePasswordErrors, deviceSetupErrors, newUserErrors, passwordError, pinError } from './accountRules';

describe('passwordError', () => {
  it('needs at least 10 characters and at most 72 bytes', () => {
    expect(passwordError('')).toBe('Enter a password');
    expect(passwordError('short-one')).toMatch(/at least 10/);
    expect(passwordError('long-enough')).toBeNull();
    expect(passwordError('x'.repeat(73))).toMatch(/shorter/);
  });
});

describe('newUserErrors', () => {
  it('checks name, email and password', () => {
    expect(newUserErrors({ name: ' ', email: 'nope', password: 'short' })).toEqual({
      name: 'Enter their name',
      email: 'Enter a valid email address, like name@school.org',
      password: 'Use at least 10 characters',
    });
    expect(newUserErrors({ name: 'Grace', email: 'grace@example.org', password: 'kitchen-ledger-42' })).toEqual({});
  });
});

describe('changePasswordErrors', () => {
  const valid = { currentPassword: 'old-password-1', newPassword: 'new-password-1', confirmPassword: 'new-password-1' };

  it('accepts a valid change', () => {
    expect(changePasswordErrors(valid)).toEqual({});
  });

  it('needs the current password, a different new one, and a matching confirmation', () => {
    expect(changePasswordErrors({ ...valid, currentPassword: '' })).toHaveProperty('currentPassword');
    expect(changePasswordErrors({ ...valid, newPassword: 'old-password-1', confirmPassword: 'old-password-1' }))
      .toEqual({ newPassword: 'Choose a password different from your current one' });
    expect(changePasswordErrors({ ...valid, confirmPassword: 'new-password-2' })).toEqual({ confirmPassword: 'The passwords do not match' });
  });
});

describe('pinError', () => {
  it('needs 6 digits that are not easy to guess', () => {
    expect(pinError('')).toBe('Enter a 6-digit PIN');
    expect(pinError('12345')).toMatch(/exactly 6 digits/);
    expect(pinError('12a456')).toMatch(/exactly 6 digits/);
    expect(pinError('000000')).toMatch(/repeated/);
    expect(pinError('123456')).toMatch(/run of digits/);
    expect(pinError('987654')).toMatch(/run of digits/);
    expect(pinError('482915')).toBeNull();
  });
});

describe('deviceSetupErrors', () => {
  const withCode = { email: 'peter@example.org', method: 'code', activationCode: 'ABCD-EFGH-JKLM', newPassword: 'peters-password', confirmPassword: 'peters-password', pin: '482915', confirmPin: '482915', deviceName: 'Kitchen tablet', needsDeviceName: true };

  it('accepts a complete set-up with an activation code or a password', () => {
    expect(deviceSetupErrors(withCode)).toEqual({});
    expect(deviceSetupErrors({ ...withCode, method: 'password', password: 'existing-password' })).toEqual({});
  });

  it('asks for the code, matching passwords and PINs, and a device name for a new device', () => {
    expect(deviceSetupErrors({ ...withCode, activationCode: '', confirmPassword: 'other', confirmPin: '111222', deviceName: ' ' })).toEqual({
      activationCode: 'Enter the activation code from your administrator',
      confirmPassword: 'The passwords do not match',
      confirmPin: 'The PINs do not match',
      deviceName: 'Give this device a name, e.g. Kitchen tablet',
    });
    expect(deviceSetupErrors({ ...withCode, method: 'password', password: '' })).toHaveProperty('password');
    expect(deviceSetupErrors({ ...withCode, deviceName: '', needsDeviceName: false })).toEqual({});
  });
});

describe('newUserErrors for school staff', () => {
  it('needs a school instead of a password', () => {
    expect(newUserErrors({ name: 'Peter', email: 'peter@example.org', role: 'school_staff' })).toEqual({ schoolId: 'Choose their school' });
    expect(newUserErrors({ name: 'Peter', email: 'peter@example.org', role: 'school_staff', schoolId: 's1' })).toEqual({});
  });
});
