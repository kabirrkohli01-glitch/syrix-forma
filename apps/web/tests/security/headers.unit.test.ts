import { afterEach, describe, expect, it, vi } from 'vitest';
import { securityHeaders } from '@/lib/security/headers';

function headerMap() {
  return Object.fromEntries(securityHeaders().map((header) => [header.key, header.value]));
}

function cspDirectives() {
  const csp = headerMap()['Content-Security-Policy'];
  return Object.fromEntries(
    csp.split('; ').map((directive) => {
      const [name, ...values] = directive.split(' ');
      return [name, values];
    })
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the headers every response carries', () => {
  it('sends the ones that cost nothing and are always right', () => {
    const headers = headerMap();
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toContain('camera=()');
  });

  it('does not send HSTS outside production, which would pin a developer’s localhost to https', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(headerMap()['Strict-Transport-Security']).toBeUndefined();
  });

  it('sends HSTS in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(headerMap()['Strict-Transport-Security']).toContain('max-age=');
  });
});

describe('the content security policy', () => {
  it('refuses framing, plugins and base rewriting outright', () => {
    const directives = cspDirectives();
    expect(directives['frame-ancestors']).toEqual(["'none'"]);
    expect(directives['object-src']).toEqual(["'none'"]);
    expect(directives['base-uri']).toEqual(["'self'"]);
  });

  it('keeps the directives that stop data leaving free of any exception', () => {
    const directives = cspDirectives();
    // script-src and style-src carry 'unsafe-inline' by necessity and that is documented. These
    // three are what actually decide where data can go, and none of them may ever loosen.
    // Named hosts are fine; what must never appear is a source that matches everything — the
    // bare `https:` scheme, or a lone `*`, either of which makes the directive decorative.
    for (const name of ['connect-src', 'form-action', 'base-uri']) {
      expect(directives[name]).not.toContain("'unsafe-inline'");
      expect(directives[name]).not.toContain('*');
      expect(directives[name]).not.toContain('https:');
      expect(directives[name]).not.toContain('https://*');
    }
    expect(directives['form-action']).toEqual(["'self'"]);
  });

  it('allows the Clerk host this instance actually uses, read out of the publishable key', () => {
    // A production instance talks to clerk.<the company's own domain>, not *.clerk.accounts.dev,
    // and hard-coding the development host is a failure that only appears after deploying.
    const host = 'clerk.forma.example';
    vi.stubEnv(
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
      `pk_live_${Buffer.from(`${host}$`).toString('base64')}`
    );
    expect(cspDirectives()['connect-src']).toContain(`https://${host}`);
    expect(cspDirectives()['frame-src']).toContain(`https://${host}`);
  });

  it('ignores a publishable key that does not decode to a hostname', () => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_live_bm90IGEgaG9zdA==');
    // "not a host" decoded — must not be concatenated into the policy, where a space or a
    // semicolon would terminate the directive and widen everything after it.
    const sources = cspDirectives()['connect-src'].join(' ');
    expect(sources).not.toContain('not a host');
    expect(cspDirectives()['form-action']).toEqual(["'self'"]);
  });

  it('allows the browser to upload straight to the configured bucket, and only that one', () => {
    vi.stubEnv('R2_ACCOUNT_ID', 'acct123');
    const withBucket = cspDirectives()['connect-src'];
    expect(withBucket).toContain('https://acct123.r2.cloudflarestorage.com');
    // Never a wildcard — that would permit every other Cloudflare customer's bucket as well.
    expect(withBucket.join(' ')).not.toContain('*.r2.cloudflarestorage.com');

    vi.stubEnv('R2_ACCOUNT_ID', '');
    expect(cspDirectives()['connect-src'].join(' ')).not.toContain('r2.cloudflarestorage.com');
  });
});
