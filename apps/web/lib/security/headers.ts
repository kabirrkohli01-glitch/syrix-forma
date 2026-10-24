/**
 * The response headers every page and API route is served with.
 *
 * SYRIX Forma had none of these. Next.js sends no security headers by default, so until now the app
 * could be framed by any site, sent its full referrer to any outbound link, and had no limit at
 * all on where a script could connect to — which matters more here than on most apps, because a
 * single injected script in a tab holding client records can exfiltrate to anywhere it likes.
 *
 * Built as a function rather than a constant because two of the values depend on the environment:
 * the object-storage origin the browser uploads directly to, and whether HSTS should be sent at
 * all (it must not be on plain-http localhost, where it would pin the developer's browser to
 * https for this host).
 */

type Header = { key: string; value: string };

/**
 * The Clerk host this instance actually talks to, read out of the publishable key.
 *
 * Clerk encodes its frontend API host in the key itself (`pk_test_<base64 host>$`), which is the
 * only place it is reliably available at config time. Hard-coding `*.clerk.accounts.dev` covers
 * a development instance and silently breaks a production one, where the host becomes
 * `clerk.<the company's own domain>` — the kind of failure that only appears after deploying,
 * as sign-in quietly not working.
 */
function clerkHosts(): string[] {
  const hosts = ['https://*.clerk.accounts.dev', 'https://clerk.com', 'https://*.clerk.com'];

  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const encoded = key?.split('_')[2];
  if (!encoded) return hosts;

  try {
    const host = Buffer.from(encoded, 'base64').toString('utf8').replace(/\$$/, '');
    // A decoded value that is not a plausible hostname is ignored rather than concatenated into
    // the policy, where it could terminate a directive and widen the rest of it.
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) hosts.push(`https://${host}`);
  } catch {
    // A malformed key is a configuration problem that will surface far more clearly when Clerk
    // itself rejects it than by failing to build a header here.
  }

  return hosts;
}

/**
 * Where the browser is allowed to send requests.
 *
 * Uploads go straight from the browser to object storage with a pre-signed URL, so that origin
 * has to be allowed explicitly — derived from the configured account rather than wildcarded,
 * because `*.r2.cloudflarestorage.com` would permit every Cloudflare customer's bucket.
 * In development with no bucket configured, uploads fall back to a same-origin route and nothing
 * extra is needed.
 */
function connectSources(): string[] {
  const sources = ["'self'", ...clerkHosts()];

  const account = process.env.R2_ACCOUNT_ID;
  if (account) sources.push(`https://${account}.r2.cloudflarestorage.com`);

  // Sentry's browser SDK is routed through a same-origin rewrite (`tunnelRoute` in
  // next.config.ts) precisely so it needs no entry here.
  return sources;
}

function contentSecurityPolicy(): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],

    // 'unsafe-inline' and 'unsafe-eval' are stated rather than quietly omitted. Next.js injects
    // inline bootstrap scripts and Clerk's component library evaluates at runtime; removing both
    // needs a per-request nonce threaded through middleware, which is Phase 9 hardening and is
    // listed in docs/threat-model.md. Everything else below is tight, and the directives that
    // actually stop data leaving — connect-src, form-action, base-uri — carry no exception.
    'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", ...clerkHosts()],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https://img.clerk.com', 'https://*.clerk.com'],
    'font-src': ["'self'", 'data:'],
    'connect-src': connectSources(),
    'worker-src': ["'self'", 'blob:'],

    // No plugins, and no page may be the target of a <base> rewrite — the cheap way to turn one
    // injected tag into every relative URL on the page pointing somewhere else.
    'object-src': ["'none'"],
    'base-uri': ["'self'"],

    // A form on a Hub page may only post back to the Hub.
    'form-action': ["'self'"],

    // The modern replacement for X-Frame-Options. Clickjacking a page that holds approval
    // buttons is the specific thing this prevents.
    'frame-ancestors': ["'none'"],

    // Clerk renders some flows in an iframe of its own.
    'frame-src': ["'self'", ...clerkHosts()]
  };

  return Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(' ')}`)
    .join('; ');
}

export function securityHeaders(): Header[] {
  const headers: Header[] = [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy() },

    // Kept alongside frame-ancestors for browsers that honour only this one.
    { key: 'X-Frame-Options', value: 'DENY' },

    // Stops a browser guessing that an uploaded .txt is really HTML and running it. Documents
    // are downloaded through this app, so this one is load-bearing rather than boilerplate.
    { key: 'X-Content-Type-Options', value: 'nosniff' },

    // Same-origin navigation keeps the full URL; anything leaving the site gets the origin only.
    // A Hub URL can contain a client or task id, which has no business being in another site's
    // logs.
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

    // Nothing in this app uses a camera, a microphone or a location, so nothing is granted one.
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'
    },

    { key: 'X-DNS-Prefetch-Control', value: 'off' }
  ];

  // Only where the app is actually served over TLS. Sending it from http://localhost pins a
  // developer's browser to https for localhost, which then breaks every other local project on
  // that machine — an unpleasant, non-obvious, and persistent thing to do to someone.
  if (process.env.NODE_ENV === 'production') {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains; preload'
    });
  }

  return headers;
}
