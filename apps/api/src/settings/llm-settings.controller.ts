import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
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
import { QueueControlService } from '../queue/queue-control.service';
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
  private readonly logger = new Logger(LlmSettingsController.name);

  constructor(
    private readonly settings: LlmSettingsService,
    private readonly vision: VisionService,
    private readonly queueControl: QueueControlService,
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
      'Omit `apiKey`/`model` to keep them; send "" to clear. `baseUrl` is ' +
      'required unless one is already stored. The key is encrypted at rest ' +
      'and never returned. Saving a key also resumes a photo-import queue ' +
      'paused by an LLM configuration error.',
  })
  @ApiOkResponse({ type: LlmSettingsModel })
  @ApiBadRequestResponse({
    description: 'Unknown provider, over-long model/apiKey, or unknown field',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  async put(@Body() dto: PutLlmSettingsDto): Promise<LlmSettingsModel> {
    const result = await this.settings.save(dto);
    if (result.importEnabled) {
      try {
        await this.queueControl.resumeIfPausedBy('llm');
      } catch (error) {
        // A resume failure must not fail the settings write.
        this.logger.warn(
          `Failed to resume the photo-import queue after an LLM settings update: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return result;
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
