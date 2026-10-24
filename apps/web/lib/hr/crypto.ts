import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { deriveKey } from '@/lib/auth/mfa-keys';

const AES_KEY_INFO = 'syrix-forma:hr-personal-data:aes-256-gcm';

/**
 * Encryption for the HR fields that must never sit in the database in plaintext: salary,
 * hourly rate, bank details and National Insurance number.
 *
 * Same construction as lib/integrations/crypto.ts and lib/auth/mfa-crypto.ts, but with its
 * own HKDF `info` string. That domain separation is the point of putting this in a third
 * file rather than importing the integrations helper: the key that decrypts a third-party
 * API token must not also decrypt payroll, so that a compromise of one does not widen into
 * the other. All three still derive from the single MFA_ENCRYPTION_KEY master secret, so
 * there is no additional key to manage or rotate.
 */
export function encryptHrField(plaintext: string): string {
  const key = deriveKey(AES_KEY_INFO);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString('base64')).join(':');
}

export function decryptHrField(stored: string): string {
  const [ivB64, authTagB64, ciphertextB64] = stored.split(':');
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Malformed encrypted HR field');
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

/**
 * Convenience for the common "field may be unset" case, so callers do not each re-invent a
 * null check around the two functions above.
 */
export function encryptOptionalHrField(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  return encryptHrField(plaintext);
}

export function decryptOptionalHrField(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined || stored === '') return null;
  return decryptHrField(stored);
}
