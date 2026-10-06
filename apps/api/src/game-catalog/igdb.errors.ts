/**
 * IGDB error taxonomy. `retryable` distinguishes a transient failure (rate
 * limit, timeout, network, 5xx) from a permanent one (rejected credentials,
 * malformed query) without ever carrying the client secret.
 */
export class IgdbError extends Error {
  constructor(
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'IgdbError';
  }
}

/** Maps an upstream HTTP status to a safe IGDB error. */
export function igdbErrorFromStatus(status: number): IgdbError {
  if (status === 401 || status === 403) {
    return new IgdbError(false, 'IGDB rejected the credentials');
  }
  if (status === 429) {
    return new IgdbError(true, 'IGDB rate-limited the request');
  }
  if (status >= 500) {
    return new IgdbError(true, 'IGDB returned a server error');
  }
  return new IgdbError(
    false,
    `IGDB rejected the request (HTTP ${String(status)})`,
  );
}
