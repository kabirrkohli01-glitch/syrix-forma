import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeUrlProblem } from '@/lib/connectors/url-guard';

/**
 * A connector URL is typed by a person and then fetched by the server, so this guard is the
 * difference between a settings page and a server-side request forgery primitive. These are the
 * cases that would matter if it regressed.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('addresses the Hub refuses to fetch', () => {
  it('refuses plain http on a public host', () => {
    expect(describeUrlProblem('http://example.com/mcp')).toMatch(/https/i);
  });

  it('refuses a URL carrying credentials, so the token goes in its own field', () => {
    expect(describeUrlProblem('https://user:secret@example.com/mcp')).toMatch(/username and password/i);
  });

  it.each([
    'https://10.0.0.5/mcp',
    'https://192.168.1.1/mcp',
    'https://172.16.4.2/mcp',
    // The cloud metadata endpoint — the single most valuable SSRF target on a hosted box.
    'https://169.254.169.254/latest/meta-data/',
    'https://db.internal/mcp',
    'https://printer.local/mcp'
  ])('refuses the private address %s', (url) => {
    expect(describeUrlProblem(url)).toMatch(/private network/i);
  });

  it('refuses something that is not a URL at all', () => {
    expect(describeUrlProblem('not a url')).toMatch(/valid URL/i);
    expect(describeUrlProblem('')).toMatch(/valid URL/i);
  });
});

describe('addresses the Hub accepts', () => {
  it('accepts a public https endpoint', () => {
    expect(describeUrlProblem('https://example.com/mcp')).toBeNull();
    expect(describeUrlProblem('https://api.example.co.uk/v1/me?x=1')).toBeNull();
  });

  it('accepts localhost while developing, because that is where a server being built runs', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(describeUrlProblem('http://localhost:3333/mcp')).toBeNull();
    expect(describeUrlProblem('http://127.0.0.1:3333/mcp')).toBeNull();
  });

  it('refuses localhost once deployed, where nothing legitimate is on it', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(describeUrlProblem('http://localhost:3333/mcp')).toMatch(/deployed Hub/i);
    expect(describeUrlProblem('https://127.0.0.1/mcp')).toMatch(/deployed Hub/i);
  });
});
