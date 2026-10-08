import { Body, Controller, Get, Inject, Post, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AUTH_CONFIG, type AuthConfig } from '../auth/auth.config';
import { Public } from '../auth/public.decorator';
import { setLocaleCookie } from '../i18n/locale-cookie';
import { SetupDto } from './dto/setup.dto';
import { SetupResponseModel, SetupStatusModel } from './dto/setup.model';
import { SetupService } from './setup.service';

@ApiTags('setup')
@Controller('setup')
export class SetupController {
  constructor(
    private readonly setup: SetupService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Public()
  @Get('status')
  @ApiOperation({
    summary:
      'Report whether first-run setup is still required (users table empty)',
  })
  @ApiOkResponse({ type: SetupStatusModel })
  status(): Promise<SetupStatusModel> {
    return this.setup.status();
  }

  @Public()
  @Post()
  @ApiOperation({
    summary:
      'Create the first account; permanently disabled once a user exists',
  })
  @ApiCreatedResponse({ type: SetupResponseModel })
  @ApiBadRequestResponse({
    description: 'Validation error, blank email, or empty password',
  })
  @ApiConflictResponse({ description: 'Setup has already been completed' })
  async create(
    @Body() dto: SetupDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SetupResponseModel> {
    const user = await this.setup.setup(dto);
    // First-run setup is also a "login" from the web app's point of view: set
    // the locale cookie so the freshly created account's language is applied
    // on the very next render.
    setLocaleCookie(res, user.language, this.config.cookieSecure);
    return { user };
  }
}
