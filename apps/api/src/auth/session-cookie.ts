import type { Response } from 'express';
import type { AuthConfig } from './auth.config';

export const SESSION_COOKIE_NAME = 'gameshelf_session';

/** Parse one cookie from a raw Cookie header. No cookie-parser dependency. */
export function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (cookieHeader === undefined || cookieHeader === '') {
    return undefined;
  }
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      continue;
    }
    if (part.slice(0, eq).trim() !== name) {
      continue;
    }
    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

export function setSessionCookie(
  res: Response,
  token: string,
  expiresAt: Date,
  config: AuthConfig,
): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response, config: AuthConfig): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
  });
}
