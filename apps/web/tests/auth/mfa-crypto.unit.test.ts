import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptMfaSecret, encryptMfaSecret } from '@/lib/auth/mfa-crypto';
import { mintSignedDeviceCookie, readSignedDeviceId } from '@/lib/auth/device-cookie';

/**
 * The authenticator-app flow these helpers were written for is gone, but the encryption itself
 * is not: lib/hr/crypto.ts and lib/integrations/crypto.ts both build on it, so it now protects
 * employee identity fields and every stored integration credential. It is tested here because
 * that is where it lives, not because MFA still exists.
 */
describe('at-rest encryption', () => {
  it('round-trips a secret through encrypt/decrypt', () => {
    const secret = randomBytes(20).toString('base64');
    const encrypted = encryptMfaSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptMfaSecret(encrypted)).toBe(secret);
  });

  it('rejects a tampered ciphertext (auth tag check fails)', () => {
    const encrypted = encryptMfaSecret(randomBytes(20).toString('base64'));
    const [iv, tag, ciphertext] = encrypted.split(':');
    const tamperedCiphertext = Buffer.from(ciphertext, 'base64');
    tamperedCiphertext[0] ^= 0xff;
    const tampered = [iv, tag, tamperedCiphertext.toString('base64')].join(':');
    expect(() => decryptMfaSecret(tampered)).toThrow();
  });
});

/**
 * The device cookie decides whether a sign-in is reported as coming from somewhere new. It is
 * signed for exactly one reason: an unsigned identifier could be set to a value the account has
 * used before, which would make an unfamiliar sign-in look familiar and suppress the alert.
 */
describe('device cookie signing', () => {
  it('reads back the id it minted', () => {
    const cookie = mintSignedDeviceCookie();
    const deviceId = readSignedDeviceId(cookie);
    expect(deviceId).toBeTruthy();
    expect(cookie.startsWith(`${deviceId}.`)).toBe(true);
  });

  it('mints a different id every time', () => {
    expect(readSignedDeviceId(mintSignedDeviceCookie())).not.toBe(
      readSignedDeviceId(mintSignedDeviceCookie())
    );
  });

  it('rejects an id presented with the wrong signature', () => {
    // The attack this exists to stop: claiming to be a device the account already trusts.
    const victimId = readSignedDeviceId(mintSignedDeviceCookie())!;
    expect(readSignedDeviceId(`${victimId}.not-a-real-signature`)).toBeNull();
  });

  it('rejects an unsigned value, a malformed one, and nothing at all', () => {
    expect(readSignedDeviceId('bare-device-id')).toBeNull();
    expect(readSignedDeviceId('')).toBeNull();
    expect(readSignedDeviceId(undefined)).toBeNull();
  });

  it('will not accept one device id signed for another', () => {
    const [first, second] = [mintSignedDeviceCookie(), mintSignedDeviceCookie()];
    const signatureOfSecond = second.split('.')[1];
    const idOfFirst = first.split('.')[0];
    expect(readSignedDeviceId(`${idOfFirst}.${signatureOfSecond}`)).toBeNull();
  });
});
