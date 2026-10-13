import { describe, expect, it } from 'vitest';
import {
  clearDeviceIdentity,
  createDeviceKeys,
  getDeviceIdentity,
  saveDeviceIdentity,
  signChallenge,
  updateDeviceStatus,
} from './deviceIdentity';

function fromBase64Url(text) {
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)), (c) => c.charCodeAt(0));
}

describe('device keys', () => {
  it('make a private key that cannot be exported, and a public P-256 JWK without private parts', async () => {
    const { privateKey, publicJwk } = await createDeviceKeys();

    expect(privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('jwk', privateKey)).rejects.toThrow();
    expect(publicJwk).toEqual({ kty: 'EC', crv: 'P-256', x: expect.any(String), y: expect.any(String) });
  });

  it('sign challenges so the public key verifies them', async () => {
    const { privateKey, publicJwk } = await createDeviceKeys();
    const publicKey = await crypto.subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);

    const signature = await signChallenge(privateKey, 'challenge-123');

    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, fromBase64Url(signature), new TextEncoder().encode('challenge-123'));
    const wrong = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, fromBase64Url(signature), new TextEncoder().encode('another'));
    expect(fromBase64Url(signature)).toHaveLength(64);
    expect(valid).toBe(true);
    expect(wrong).toBe(false);
  });
});

describe('device identity', () => {
  it('is saved with its key and can still sign afterwards', async () => {
    const { privateKey } = await createDeviceKeys();
    await saveDeviceIdentity({ deviceId: 'device-1', name: 'Kitchen tablet', status: 'pending', privateKey });

    await updateDeviceStatus('approved');
    const stored = await getDeviceIdentity();

    expect(stored).toMatchObject({ deviceId: 'device-1', name: 'Kitchen tablet', status: 'approved' });
    await expect(signChallenge(stored.privateKey, 'x')).resolves.toEqual(expect.any(String));
  });

  it('is empty until set up, and can be cleared', async () => {
    expect(await getDeviceIdentity()).toBeNull();
    await saveDeviceIdentity({ deviceId: 'device-1', name: 'Tablet', status: 'approved', privateKey: (await createDeviceKeys()).privateKey });

    await clearDeviceIdentity();

    expect(await getDeviceIdentity()).toBeNull();
  });
});
