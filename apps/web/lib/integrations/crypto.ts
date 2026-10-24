import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { deriveKey } from '@/lib/auth/mfa-keys';

const AES_KEY_INFO = 'syrix-forma:integration-credentials:aes-256-gcm';

// Same construction as lib/auth/mfa-crypto.ts, reusing MFA_ENCRYPTION_KEY as the one master
// secret (HKDF domain-separated by info string) rather than adding a second key to manage and
// rotate. Holds API tokens/webhook secrets for third-party integrations — never plaintext at rest.
export function encryptIntegrationCredentials(plaintext: string): string {
  const key = deriveKey(AES_KEY_INFO);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString('base64')).join(':');
}

export function decryptIntegrationCredentials(stored: string): string {
  const [ivB64, authTagB64, ciphertextB64] = stored.split(':');
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Malformed encrypted integration credentials');
  }

  const key = deriveKey(AES_KEY_INFO);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final()
  ]);
  return plaintext.toString('utf8');
}
