import { describe, expect, it } from 'vitest';
import { decryptIntegrationCredentials, encryptIntegrationCredentials } from '@/lib/integrations/crypto';

describe('integration credentials encryption', () => {
  it('round-trips a JSON credentials blob through encrypt/decrypt', () => {
    const secret = JSON.stringify({ apiToken: 'tok_abc123', mailboxResourceId: 'mbx_1' });
    const encrypted = encryptIntegrationCredentials(secret);
    expect(encrypted).not.toContain('tok_abc123');
    expect(decryptIntegrationCredentials(encrypted)).toBe(secret);
  });

  it('rejects a tampered ciphertext (auth tag check fails)', () => {
    const encrypted = encryptIntegrationCredentials('some secret value');
    const [iv, tag, ciphertext] = encrypted.split(':');
    const tamperedCiphertext = Buffer.from(ciphertext, 'base64');
    tamperedCiphertext[0] ^= 0xff;
    const tampered = [iv, tag, tamperedCiphertext.toString('base64')].join(':');
    expect(() => decryptIntegrationCredentials(tampered)).toThrow();
  });

  it('uses a different HKDF domain than MFA secrets — a value encrypted for one context is not decryptable via the other', async () => {
    const { encryptMfaSecret } = await import('@/lib/auth/mfa-crypto');
    const mfaEncrypted = encryptMfaSecret('same-plaintext-value');
    const integrationEncrypted = encryptIntegrationCredentials('same-plaintext-value');
    expect(mfaEncrypted).not.toBe(integrationEncrypted);
  });
});
