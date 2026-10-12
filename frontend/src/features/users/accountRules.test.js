import { describe, expect, it } from 'vitest';
import { changePasswordErrors, newUserErrors, passwordError } from './accountRules';

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
