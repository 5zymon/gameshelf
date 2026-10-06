import { Global, Module } from '@nestjs/common';
import { LlmSettingsController } from './llm-settings.controller';
import { LlmKeyCryptoService } from './llm-key-crypto.service';
import { LlmSettingsService } from './llm-settings.service';
import {
  FetchVisionHttpClient,
  VisionHttpClient,
} from './vision/vision-http.client';
import { GeminiVisionProvider } from './vision/gemini-vision.provider';
import { OpenAiVisionProvider } from './vision/openai-vision.provider';
import { VisionProviderRegistry } from './vision/vision-provider.registry';
import { VisionService } from './vision/vision.service';

/**
 * Global so the import pipeline can inject `LlmSettingsService`/`VisionService`
 * without importing this module (ticket 3.5 will consume `VisionService`).
 */
@Global()
@Module({
  controllers: [LlmSettingsController],
  providers: [
    LlmSettingsService,
    LlmKeyCryptoService,
    VisionService,
    VisionProviderRegistry,
    GeminiVisionProvider,
    OpenAiVisionProvider,
    { provide: VisionHttpClient, useClass: FetchVisionHttpClient },
  ],
  exports: [LlmSettingsService, VisionService],
})
export class SettingsModule {}
