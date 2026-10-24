import { describe, expect, it } from 'vitest';
import { assertProductionConfig, collectConfigProblems } from '@/lib/config/preflight';

/** A deployment with nothing wrong with it. */
function validEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:pass@host/db',
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_abc',
    CLERK_SECRET_KEY: 'sk_live_abc',
    MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    NEXT_PUBLIC_APP_URL: 'https://hub.example.com',
    RESEND_API_KEY: 're_abc',
    NOTIFICATIONS_FROM_EMAIL: 'hub@example.com',
    REDIS_URL: 'rediss://host',
    R2_ACCOUNT_ID: 'acc',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET_NAME: 'bucket',
    FORMA_AI_GATEWAY_URL: 'https://gateway.example.com',
    FORMA_AI_GATEWAY_TOKEN: 'token'
  } as NodeJS.ProcessEnv;
}

describe('production preflight', () => {
  it('passes a fully configured deployment', () => {
    expect(collectConfigProblems(validEnv())).toEqual([]);
    expect(() => assertProductionConfig(validEnv())).not.toThrow();
  });

  it('refuses to start on Clerk development keys', () => {
    // The whole reason this check exists: a dev instance works perfectly, which is exactly what
    // makes shipping on one easy to do and hard to notice.
    const env = { ...validEnv(), NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_abc', CLERK_SECRET_KEY: 'sk_test_abc' };
    expect(() => assertProductionConfig(env)).toThrow(/development key/);
  });

  it('permits development keys only when the deployment declares itself staging', () => {
    const devKeys = {
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_abc',
      CLERK_SECRET_KEY: 'sk_test_abc'
    };
    expect(() => assertProductionConfig({ ...validEnv(), ...devKeys, APP_ENV: 'staging' })).not.toThrow();

    // Anything other than the exact opt-in is production, and production refuses. A typo in
    // APP_ENV must fail closed rather than quietly grant the exception.
    for (const value of ['production', 'Staging', 'STAGING', 'stage', '']) {
      expect(() =>
        assertProductionConfig({ ...validEnv(), ...devKeys, APP_ENV: value })
      ).toThrow(/development key/);
    }
  });

  it('still requires everything else of a staging deployment', () => {
    // Staging relaxes exactly one thing. It is not a way to skip configuration.
    const env: NodeJS.ProcessEnv = { ...validEnv(), APP_ENV: 'staging' };
    delete env.MFA_ENCRYPTION_KEY;
    expect(() => assertProductionConfig(env)).toThrow(/MFA_ENCRYPTION_KEY/);
  });

  it('names every missing variable rather than only the first', () => {
    const env = { ...validEnv() };
    delete env.RESEND_API_KEY;
    delete env.REDIS_URL;

    const problems = collectConfigProblems(env);
    expect(problems.map((p) => p.variable)).toEqual(['RESEND_API_KEY', 'REDIS_URL']);
  });

  it('starts without object storage, which costs three features and nothing else', () => {
    // Enabling R2 needs a payment method on the Cloudflare account. Refusing to boot over it
    // would trade a working Hub for the ability to attach files.
    const env = { ...validEnv() };
    for (const name of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']) {
      delete env[name];
    }
    expect(() => assertProductionConfig(env)).not.toThrow();
  });

  it('refuses a half-configured bucket, which is a typo rather than a decision', () => {
    const env = { ...validEnv() };
    delete env.R2_BUCKET_NAME;
    expect(() => assertProductionConfig(env)).toThrow(/all four R2_\* values or none/);
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    const env = { ...validEnv(), MFA_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') };
    expect(() => assertProductionConfig(env)).toThrow(/32 bytes/);
  });

  it('leaves local development alone', () => {
    // A laptop has no object storage and no mail provider, and is not supposed to need them.
    expect(() => assertProductionConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).not.toThrow();
  });
});
