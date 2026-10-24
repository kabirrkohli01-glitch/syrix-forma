/**
 * Whether the Hub is willing to make a server-side request to an address someone typed.
 *
 * This is the control that matters most about connectors. A connector URL is supplied by a person
 * and then fetched by the server, which is server-side request forgery in its plainest form
 * unless the target is constrained: an address pointing at the cloud provider's metadata endpoint
 * or at anything else on the internal network would otherwise be fetched with the Hub's own
 * network position behind it, and the result handed back to whoever typed it.
 *
 * https only, no credentials embedded in the URL, and nothing that is obviously internal.
 * Loopback is the one deliberate exception, because an MCP server under development genuinely
 * runs there — and it is refused outright in production, where nothing legitimate is on
 * localhost.
 *
 * Hostname patterns are not a complete defence on their own: a public DNS name can resolve to a
 * private address, and resolution happens after this check. Closing that needs the resolved IP to
 * be checked at connect time, which Node's fetch does not expose — recorded here rather than
 * implied to be handled, and listed with the Phase 9 hardening in docs/threat-model.md.
 */
const BLOCKED_HOSTNAME_PATTERNS = [
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /\.internal$/i,
  /\.local$/i
];

const LOOPBACK = /^(localhost|127(\.\d+){3}|\[?::1\]?)$/i;

/** Returns a sentence describing what is wrong with the URL, or null when it is acceptable. */
export function describeUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'That is not a valid URL. It should start with https://';
  }

  if (url.username || url.password) {
    return 'Remove the username and password from the URL — put the credential in the token field instead';
  }

  if (LOOPBACK.test(url.hostname)) {
    if (process.env.NODE_ENV === 'production') {
      return 'A deployed Hub cannot reach a server on localhost';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'Use an http:// or https:// address';
    }
    return null;
  }

  if (url.protocol !== 'https:') {
    return 'Use an https:// address — a token sent over http is readable in transit';
  }

  if (BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(url.hostname))) {
    return 'That address is on a private network, which the Hub will not fetch from';
  }

  return null;
}
