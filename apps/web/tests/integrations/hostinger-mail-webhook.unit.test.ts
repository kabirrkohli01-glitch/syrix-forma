import { describe, expect, it } from 'vitest';
import { normalizeInboundMessage, verifyWebhookAuthorization } from '@/lib/integrations/hostinger-mail/webhook';

describe('verifyWebhookAuthorization', () => {
  const token = 'a-real-webhook-token-1234567890';

  it('accepts a matching bearer token', () => {
    expect(verifyWebhookAuthorization(`Bearer ${token}`, token)).toBe(true);
  });

  it('rejects a wrong token of the same length', () => {
    expect(verifyWebhookAuthorization(`Bearer ${'x'.repeat(token.length)}`, token)).toBe(false);
  });

  it('rejects a token of a different length (no length-based shortcut leak)', () => {
    expect(verifyWebhookAuthorization('Bearer short', token)).toBe(false);
  });

  it('rejects a missing Authorization header', () => {
    expect(verifyWebhookAuthorization(null, token)).toBe(false);
  });

  it('rejects a header that is not a Bearer token', () => {
    expect(verifyWebhookAuthorization(`Basic ${token}`, token)).toBe(false);
  });
});

describe('normalizeInboundMessage', () => {
  it('normalizes a typical payload shape', () => {
    const result = normalizeInboundMessage({
      uid: '42',
      from: 'contact@example.test',
      to: ['mailbox@example.com'],
      subject: 'Hello',
      snippet: 'Hi there',
      date: '2026-01-01T00:00:00.000Z'
    });
    expect(result).toMatchObject({
      externalMessageId: '42',
      fromAddress: 'contact@example.test',
      toAddresses: ['mailbox@example.com'],
      subject: 'Hello',
      snippet: 'Hi there'
    });
  });

  it('falls back to alternate field names (id/sender/preview/timestamp)', () => {
    const result = normalizeInboundMessage({
      id: 7,
      sender: 'other@example.test',
      preview: 'A preview',
      timestamp: '2026-02-02T00:00:00.000Z'
    });
    expect(result.externalMessageId).toBe('7');
    expect(result.fromAddress).toBe('other@example.test');
    expect(result.snippet).toBe('A preview');
  });

  it('throws on a payload missing both an id and a sender', () => {
    expect(() => normalizeInboundMessage({ subject: 'No sender or id' })).toThrow();
  });

  it('falls back to now() for an unparseable date rather than producing an Invalid Date', () => {
    const result = normalizeInboundMessage({ uid: '1', from: 'a@example.test', date: 'not-a-date' });
    expect(Number.isNaN(result.occurredAt.getTime())).toBe(false);
  });
});
