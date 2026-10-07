/**
 * MobyGames error taxonomy. `retryable` distinguishes a transient failure (rate
 * limit, timeout, network, 5xx) from a permanent one (rejected credentials,
 * malformed request) without ever carrying the API key or the request URL.
 */
export class MobygamesError extends Error {
  constructor(
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'MobygamesError';
  }
}

/** Rejected/absent MobyGames configuration (API key), not a data error. */
export class MobygamesConfigError extends MobygamesError {
  constructor(message: string) {
    super(false, message);
    this.name = 'MobygamesConfigError';
  }
}

/** Maps an upstream HTTP status to a safe MobyGames error. */
export function mobygamesErrorFromStatus(status: number): MobygamesError {
  if (status === 401 || status === 403) {
    return new MobygamesConfigError('MobyGames rejected the credentials');
  }
  if (status === 429) {
    return new MobygamesError(true, 'MobyGames rate-limited the request');
  }
  if (status >= 500) {
    return new MobygamesError(true, 'MobyGames returned a server error');
  }
  return new MobygamesError(
    false,
    `MobyGames rejected the request (HTTP ${String(status)})`,
  );
}
