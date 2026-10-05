import type { Response } from 'express';
import type { AuthConfig } from '../../src/auth/auth.config';
import {
  clearSessionCookie,
  readCookie,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from '../../src/auth/session-cookie';

const CONFIG: AuthConfig = {
  sessionSecret: 'a'.repeat(40),
  sessionTtlMs: 60_000,
  cookieSecure: false,
};

function responseMock(): {
  res: Response;
  cookie: jest.Mock;
  clearCookie: jest.Mock;
} {
  const cookie = jest.fn();
  const clearCookie = jest.fn();
  return {
    res: { cookie, clearCookie } as unknown as Response,
    cookie,
    clearCookie,
  };
}

describe('readCookie (unit)', () => {
  it('finds the named cookie among others', () => {
    expect(
      readCookie('a=1; gameshelf_session=token123; b=2', SESSION_COOKIE_NAME),
    ).toBe('token123');
  });

  it('returns undefined when the cookie is absent or the header is empty', () => {
    expect(readCookie('other=1', SESSION_COOKIE_NAME)).toBeUndefined();
    expect(readCookie(undefined, SESSION_COOKIE_NAME)).toBeUndefined();
    expect(readCookie('', SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('handles "=" inside the value, surrounding spaces, and URL-encoding', () => {
    expect(readCookie('gameshelf_session= abc=def ', SESSION_COOKIE_NAME)).toBe(
      'abc=def',
    );
    expect(readCookie('gameshelf_session=a%20b', SESSION_COOKIE_NAME)).toBe(
      'a b',
    );
  });

  it('ignores malformed parts without an "="', () => {
    expect(
      readCookie(
        'gameshelf_session; gameshelf_session=ok',
        SESSION_COOKIE_NAME,
      ),
    ).toBe('ok');
  });
});

describe('setSessionCookie (unit)', () => {
  it('sets name/token and the httpOnly Lax flags (secure false)', () => {
    const { res, cookie } = responseMock();
    const expires = new Date('2026-10-05T12:00:00.000Z');

    setSessionCookie(res, 'token', expires, CONFIG);

    expect(cookie).toHaveBeenCalledWith(SESSION_COOKIE_NAME, 'token', {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      expires,
    });
  });

  it('adds Secure when cookieSecure is true', () => {
    const { res, cookie } = responseMock();
    const expires = new Date('2026-10-05T12:00:00.000Z');

    setSessionCookie(res, 'token', expires, { ...CONFIG, cookieSecure: true });

    expect(cookie).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      'token',
      expect.objectContaining({ secure: true, httpOnly: true }),
    );
  });
});

describe('clearSessionCookie (unit)', () => {
  it('clears the cookie with the same path and flags', () => {
    const { res, clearCookie } = responseMock();

    clearSessionCookie(res, CONFIG);

    expect(clearCookie).toHaveBeenCalledWith(SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
    });
  });
});
