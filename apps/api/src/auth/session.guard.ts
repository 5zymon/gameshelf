import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';
import type { AuthenticatedRequest } from './auth.types';
import { IS_PUBLIC_KEY } from './public.decorator';
import {
  clearSessionCookie,
  readCookie,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from './session-cookie';
import { SessionsService } from './sessions.service';

/**
 * Single global permission level (decision #14): resolves the session cookie
 * to a server-side session and attaches `user.id` + `session`. There are no
 * role or permission checks here.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const res = http.getResponse<Response>();
    const token = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
    if (token === undefined) {
      throw new UnauthorizedException('Authentication required');
    }

    const session = await this.sessions.validate(token);
    if (session === null) {
      clearSessionCookie(res, this.config);
      throw new UnauthorizedException('Authentication required');
    }

    req.user = { id: session.userId };
    req.session = { token, expiresAt: session.expiresAt };
    setSessionCookie(res, token, session.expiresAt, this.config); // slide client cookie
    return true;
  }
}
