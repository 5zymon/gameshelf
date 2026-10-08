import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';
import { AuthService, INVALID_CREDENTIALS_MESSAGE } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
import { AuthUserModel, LoginResponseModel } from './dto/auth-user.model';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';
import { clearLocaleCookie, setLocaleCookie } from '../i18n/locale-cookie';
import {
  clearSessionCookie,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from './session-cookie';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in; sets the httpOnly session cookie' })
  @ApiOkResponse({ type: LoginResponseModel })
  @ApiUnauthorizedResponse({ description: INVALID_CREDENTIALS_MESSAGE })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseModel> {
    const { user, token, expiresAt } = await this.auth.login(
      dto.email,
      dto.password,
      req.headers['user-agent'] ?? null,
    );
    setSessionCookie(res, token, expiresAt, this.config);
    // Heal the web app's locale from the DB on every login: the browser may
    // have a stale/missing NEXT_LOCALE (fresh device, cleared cookies, or a
    // shared machine), and login is the one reliable server-render hook.
    setLocaleCookie(res, user.language, this.config.cookieSecure);
    return { user };
  }

  @Post('logout')
  @HttpCode(204)
  @ApiCookieAuth(SESSION_COOKIE_NAME)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(req.session.token);
    clearSessionCookie(res, this.config);
    // Drop the locale too so a shared device never shows the previous user's
    // language on the login screen (which falls back to the `pl` default).
    clearLocaleCookie(res, this.config.cookieSecure);
  }

  @Get('me')
  @ApiCookieAuth(SESSION_COOKIE_NAME)
  @ApiOperation({ summary: 'Return the authenticated user' })
  @ApiOkResponse({ type: AuthUserModel })
  me(@Req() req: AuthenticatedRequest): Promise<AuthUserModel> {
    return this.auth.me(req.user.id);
  }
}
