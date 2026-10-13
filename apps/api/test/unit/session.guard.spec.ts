import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthConfig } from '../../src/auth/auth.config';
import { SessionGuard } from '../../src/auth/session.guard';
import type { SessionsService } from '../../src/auth/sessions.service';
import { testId } from '../helpers/ids';

const CONFIG: AuthConfig = {
  sessionSecret: 'x'.repeat(40),
  sessionTtlMs: 60_000,
  cookieSecure: false,
};

interface RequestMock {
  headers: { cookie?: string };
  user?: { id: string };
  session?: { token: string; expiresAt: Date };
}

interface ContextMock {
  context: ExecutionContext;
  req: RequestMock;
  res: { cookie: jest.Mock; clearCookie: jest.Mock };
}

function contextMock(cookie?: string): ContextMock {
  const req: RequestMock = { headers: cookie === undefined ? {} : { cookie } };
  const res = { cookie: jest.fn(), clearCookie: jest.fn() };
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
  return { context, req, res };
}

describe('SessionGuard (unit)', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let sessions: { validate: jest.Mock };
  let guard: SessionGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    sessions = { validate: jest.fn() };
    guard = new SessionGuard(
      reflector as unknown as Reflector,
      sessions as unknown as SessionsService,
      CONFIG,
    );
  });

  it('bypasses a route marked @Public()', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const { context } = contextMock();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(sessions.validate).not.toHaveBeenCalled();
  });

  it('rejects a request with no session cookie (401)', async () => {
    const { context } = contextMock(undefined);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(sessions.validate).not.toHaveBeenCalled();
  });

  it('rejects an unknown/expired session and clears the cookies', async () => {
    sessions.validate.mockResolvedValue(null);
    const { context, res } = contextMock('gameshelf_session=bad');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      'gameshelf_session',
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
    // The locale is a per-user preference: a passively expired session on a
    // shared device must not keep the previous user's language.
    expect(res.clearCookie).toHaveBeenCalledWith(
      'NEXT_LOCALE',
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
  });

  it('attaches user.id + session and slides the cookie (no roles — AC6)', async () => {
    const expiresAt = new Date('2026-10-06T12:00:00.000Z');
    sessions.validate.mockResolvedValue({ userId: testId(7), expiresAt });
    const { context, req, res } = contextMock('gameshelf_session=good');

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(sessions.validate).toHaveBeenCalledWith('good');
    expect(req.user).toEqual({ id: testId(7) });
    expect(req.session).toEqual({ token: 'good', expiresAt });
    expect(Object.keys(req.user ?? {})).toEqual(['id']);
    expect(res.cookie).toHaveBeenCalledWith(
      'gameshelf_session',
      'good',
      expect.objectContaining({ httpOnly: true, expires: expiresAt }),
    );
  });
});
