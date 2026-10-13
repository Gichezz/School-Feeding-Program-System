import { describe, expect, it } from 'vitest';
import { passkeyErrorMessage, suggestedPasskeyName } from './passkeyClient';

describe('passkeyErrorMessage', () => {
  it('explains a cancelled or timed-out request', () => {
    expect(passkeyErrorMessage({ name: 'NotAllowedError' })).toMatch(/cancelled or timed out/);
    expect(passkeyErrorMessage({ code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', cause: { name: 'NotAllowedError' } })).toMatch(/cancelled/);
  });

  it('explains a device that already has a passkey', () => {
    expect(passkeyErrorMessage({ code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' })).toMatch(/already has a passkey/);
  });

  it('passes on messages from the server', () => {
    expect(passkeyErrorMessage({ status: 401, message: 'The passkey could not be verified. Try again.' }))
      .toBe('The passkey could not be verified. Try again.');
  });

  it('falls back to a device hint', () => {
    expect(passkeyErrorMessage(new Error('boom'))).toMatch(/screen lock/);
  });
});

describe('suggestedPasskeyName', () => {
  it('names the kind of device', () => {
    expect(suggestedPasskeyName('Mozilla/5.0 (Linux; Android 14; Pixel 7)')).toBe('Android phone');
    expect(suggestedPasskeyName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows computer');
    expect(suggestedPasskeyName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('iPhone or iPad');
    expect(suggestedPasskeyName('Something else')).toBe('This device');
  });
});
