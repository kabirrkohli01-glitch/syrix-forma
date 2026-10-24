/**
 * Errors whose message is safe to show verbatim: a refusal, a URL the Hub will not fetch, a
 * service that answered badly. Anything else thrown is an internal fault and its message must
 * not reach the UI — for connectors specifically, because a raw fetch error can carry an
 * internal hostname and a decryption error can say more about the key setup than a settings
 * screen should.
 *
 * Its own module because a `'use server'` file may only export async functions.
 */
export class ConnectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export function isConnectorError(error: unknown): error is ConnectorError {
  return error instanceof ConnectorError;
}

export function connectorErrorMessage(error: unknown): string {
  if (isConnectorError(error)) return error.message;
  return 'Something went wrong. If it keeps happening, contact your administrator.';
}
