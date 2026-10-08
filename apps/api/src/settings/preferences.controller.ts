import { Body, Controller, Get, Inject, Put, Req, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AUTH_CONFIG, type AuthConfig } from '../auth/auth.config';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { setLocaleCookie } from '../i18n/locale-cookie';
import { setThemeCookie } from './theme-cookie';
import { PreferencesModel } from './dto/preferences.model';
import { PutPreferencesDto } from './dto/put-preferences.dto';
import { PreferencesService } from './preferences.service';

/**
 * Per-user preferences (tickets 7.2/7.3). Auth is the global `SessionGuard`
 * (no `@Public()`). `PUT` also (re)writes the `NEXT_LOCALE` and `NEXT_THEME`
 * cookies so the web app picks up the new language and theme on its next
 * server render; `GET` never writes them (Next server components cannot set
 * cookies during render — login is the reliable heal).
 */
@ApiTags('settings')
@Controller('settings/preferences')
export class PreferencesController {
  constructor(
    private readonly preferences: PreferencesService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Get()
  @ApiOperation({ summary: "Read the current user's preferences" })
  @ApiOkResponse({ type: PreferencesModel })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  get(@Req() req: AuthenticatedRequest): Promise<PreferencesModel> {
    return this.preferences.get(req.user.id);
  }

  @Put()
  @ApiOperation({
    summary:
      "Update the current user's preferences; rewrites the NEXT_LOCALE and NEXT_THEME cookies",
  })
  @ApiOkResponse({ type: PreferencesModel })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  async put(
    @Body() dto: PutPreferencesDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PreferencesModel> {
    const result = await this.preferences.update(
      req.user.id,
      dto.language,
      dto.theme,
    );
    setLocaleCookie(res, result.language, this.config.cookieSecure);
    setThemeCookie(res, result.theme, this.config.cookieSecure);
    return result;
  }
}
