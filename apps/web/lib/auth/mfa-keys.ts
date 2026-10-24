import { hkdfSync } from 'node:crypto';

function loadMasterKey(): Buffer {
  const raw = process.env.MFA_ENCRYPTION_KEY;
  if (!raw) throw new Error('MFA_ENCRYPTION_KEY is not set — see .env.example');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must decode to exactly 32 bytes');
  return key;
}

// One master secret, domain-separated per purpose via HKDF `info` — never reuse the same
// derived key bytes for two different cryptographic operations (encryption vs. HMAC).
export function deriveKey(info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', loadMasterKey(), Buffer.alloc(0), Buffer.from(info), 32));
}
