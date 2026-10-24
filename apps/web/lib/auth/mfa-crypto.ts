import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { deriveKey } from './mfa-keys';

const AES_KEY_INFO = 'syrix-forma:mfa-secret:aes-256-gcm';

// Stored as base64(iv):base64(authTag):base64(ciphertext). The TOTP secret is never written
// to the database in plaintext — a DB read alone must not be enough to generate valid codes.
export function encryptMfaSecret(plaintext: string): string {
  const key = deriveKey(AES_KEY_INFO);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString('base64')).join(':');
}

export function decryptMfaSecret(stored: string): string {
  const [ivB64, authTagB64, ciphertextB64] = stored.split(':');
  if (!ivB64 || !authTagB64 || !ciphertextB64) throw new Error('Malformed encrypted MFA secret');

  const key = deriveKey(AES_KEY_INFO);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final()
  ]);
  return plaintext.toString('utf8');
}
