import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { LlmSettingsModel } from './dto/llm-settings.model';
import { LlmTestResultModel } from './dto/llm-test-result.model';
import { PutLlmSettingsDto } from './dto/put-llm-settings.dto';
import { LlmSettingsService } from './llm-settings.service';
import { VisionService } from './vision/vision.service';

/**
 * Runtime LLM configuration. Auth is the global `SessionGuard` (no
 * `@Public()`); the API key is write-only and never echoed back.
 */
@ApiTags('settings')
@Controller('settings/llm')
export class LlmSettingsController {
  constructor(
    private readonly settings: LlmSettingsService,
    private readonly vision: VisionService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Read the LLM provider settings (no API key)' })
  @ApiOkResponse({ type: LlmSettingsModel })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  get(): Promise<LlmSettingsModel> {
    return this.settings.getPublic();
  }

  @Put()
  @ApiOperation({
    summary: 'Update provider/model/API key (key is write-only)',
    description:
      'Omit `apiKey` to keep the stored key; send "" to clear it. The key is ' +
      'encrypted at rest and never returned.',
  })
  @ApiOkResponse({ type: LlmSettingsModel })
  @ApiBadRequestResponse({
    description: 'Unknown provider, over-long model/apiKey, or unknown field',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  put(@Body() dto: PutLlmSettingsDto): Promise<LlmSettingsModel> {
    return this.settings.save(dto);
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Make one real call with a 1x1 PNG and report the result',
    description:
      'Always HTTP 200. A completed-but-failed test is `{ ok: false, code }`.',
  })
  @ApiOkResponse({ type: LlmTestResultModel })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  test(): Promise<LlmTestResultModel> {
    return this.vision.test();
  }
}
