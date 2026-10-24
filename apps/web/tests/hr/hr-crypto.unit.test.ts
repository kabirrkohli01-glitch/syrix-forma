import { beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

// Set before importing the module under test: lib/auth/mfa-keys.ts reads the master key from
// the environment on every derivation, and the suite must not depend on a developer's real key
// being present. Same convention as tests/auth/mfa-crypto.unit.test.ts.
beforeAll(() => {
  process.env.MFA_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
});

const { decryptHrField, decryptOptionalHrField, encryptHrField, encryptOptionalHrField } =
  await import('@/lib/hr/crypto');

describe('HR field encryption', () => {
  it('round-trips a value', () => {
    const plaintext = 'QQ123456C';
    expect(decryptHrField(encryptHrField(plaintext))).toBe(plaintext);
  });

  it('round-trips values with non-ASCII characters', () => {
    const plaintext = 'Ángel Müller-Ortiz — £52,000';
    expect(decryptHrField(encryptHrField(plaintext))).toBe(plaintext);
  });

  it('never stores the plaintext in the ciphertext', () => {
    const plaintext = '52000';
    expect(encryptHrField(plaintext)).not.toContain(plaintext);
  });

  it('produces a different ciphertext each time, so equal salaries are not detectable', () => {
    // A deterministic scheme would let anyone with read access to the column work out which
    // employees are paid the same by comparing stored strings, without decrypting anything.
    const first = encryptHrField('52000');
    const second = encryptHrField('52000');
    expect(first).not.toBe(second);
    expect(decryptHrField(first)).toBe(decryptHrField(second));
  });

  it('rejects a tampered ciphertext rather than returning wrong plaintext', () => {
    const stored = encryptHrField('52000');
    const [iv, authTag, ciphertext] = stored.split(':');
    const flipped = Buffer.from(ciphertext!, 'base64');
    flipped[0] ^= 0xff;
    const tampered = [iv, authTag, flipped.toString('base64')].join(':');
    expect(() => decryptHrField(tampered)).toThrow();
  });

  it('rejects a malformed stored value', () => {
    expect(() => decryptHrField('not-encrypted')).toThrow('Malformed encrypted HR field');
  });

  it('treats null, undefined and empty string as "not set" in both directions', () => {
    expect(encryptOptionalHrField(null)).toBeNull();
    expect(encryptOptionalHrField(undefined)).toBeNull();
    expect(encryptOptionalHrField('')).toBeNull();
    expect(decryptOptionalHrField(null)).toBeNull();
    expect(decryptOptionalHrField(undefined)).toBeNull();
    expect(decryptOptionalHrField('')).toBeNull();
  });

  it('round-trips through the optional helpers', () => {
    expect(decryptOptionalHrField(encryptOptionalHrField('12.50'))).toBe('12.50');
  });
});
