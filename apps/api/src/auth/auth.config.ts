import { ConfigService } from '@nestjs/config';

/** DI token for the validated auth configuration. */
export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

/** Sliding session lifetime is finite — there is no "never" value. */
export const DEFAULT_SESSION_TTL_MINUTES = 10_080; // 7 days
export const MIN_SESSION_TTL_MINUTES = 1;
export const MAX_SESSION_TTL_MINUTES = 525_600; // 1 year
export const MIN_SESSION_SECRET_LENGTH = 32;

/** Expired-row sweep cadence (code constant, deliberately not env-driven). */
export const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export interface AuthConfig {
  /** HMAC-SHA256 key used to derive the stored session id from the cookie token. */
  sessionSecret: string;
  /** Finite sliding session lifetime in milliseconds. */
  sessionTtlMs: number;
  /** Send the session cookie only over HTTPS (`Secure` flag). */
  cookieSecure: boolean;
}

export function loadAuthConfig(config: ConfigService): AuthConfig {
  const sessionSecret = config.getOrThrow<string>('SESSION_SECRET');
  if (sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be at least ${String(MIN_SESSION_SECRET_LENGTH)} characters`,
    );
  }
  const raw = config.get<string>('SESSION_TTL_MINUTES');
  const minutes =
    raw === undefined || raw === '' ? DEFAULT_SESSION_TTL_MINUTES : Number(raw);
  if (
    !Number.isInteger(minutes) ||
    minutes < MIN_SESSION_TTL_MINUTES ||
    minutes > MAX_SESSION_TTL_MINUTES
  ) {
    throw new Error(
      `SESSION_TTL_MINUTES must be an integer between ` +
        `${String(MIN_SESSION_TTL_MINUTES)} and ${String(MAX_SESSION_TTL_MINUTES)} ` +
        `(a finite lifetime; "never" is not supported)`,
    );
  }
  const rawSecure = config.get<string>('SESSION_COOKIE_SECURE');
  let cookieSecure = false;
  if (rawSecure !== undefined && rawSecure !== '') {
    const v = rawSecure.trim().toLowerCase();
    if (v === 'true' || v === '1') cookieSecure = true;
    else if (v === 'false' || v === '0') cookieSecure = false;
    else {
      throw new Error(
        `SESSION_COOKIE_SECURE must be "true"/"1" or "false"/"0" (got "${rawSecure}")`,
      );
    }
  }
  return { sessionSecret, sessionTtlMs: minutes * 60_000, cookieSecure };
}
