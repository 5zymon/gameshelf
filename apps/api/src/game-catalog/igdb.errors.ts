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

/** Rejected/absent IGDB configuration (credentials), not a data error. */
export class IgdbConfigError extends IgdbError {
  constructor(message: string) {
    super(false, message);
    this.name = 'IgdbConfigError';
  }
}

/** Maps an upstream HTTP status to a safe IGDB error. */
export function igdbErrorFromStatus(status: number): IgdbError {
  if (status === 401 || status === 403) {
    return new IgdbConfigError('IGDB rejected the credentials');
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

/**
 * Maps a Twitch OAuth token-endpoint status to an IGDB error. Unlike the Games
 * API, any non-transient non-2xx here means the token endpoint could not issue
 * a token for the configured client id/secret: Twitch returns 400
 * (`invalid client`) for bad credentials as well as 401/403, and a 404/other 4xx
 * usually means `IGDB_TOKEN_URL` points somewhere wrong. Those must surface as
 * `IgdbConfigError` (503), not as a permanent request error that an empty
 * search would swallow. 429/5xx and network failures stay retryable.
 */
export function igdbTokenErrorFromStatus(status: number): IgdbError {
  if (status === 429) {
    return new IgdbError(true, 'IGDB rate-limited the request');
  }
  if (status >= 500) {
    return new IgdbError(true, 'IGDB returned a server error');
  }
  return new IgdbConfigError(
    `IGDB token endpoint rejected the request (HTTP ${String(status)})`,
  );
}
