import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GameDatabaseController } from './game-database.controller';
import { GameDatabaseStatusService } from './game-database-status.service';
import { LlmSettingsController } from './llm-settings.controller';
import { LlmKeyCryptoService } from './llm-key-crypto.service';
import { LlmSettingsService } from './llm-settings.service';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';
import {
  FetchVisionHttpClient,
  VisionHttpClient,
} from './vision/vision-http.client';
import { CustomVisionProvider } from './vision/custom-vision.provider';
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
  // `AuthModule` provides the `AUTH_CONFIG` token the preferences controller
  // reads to mirror the session cookie's `Secure` flag onto `NEXT_LOCALE`.
  imports: [AuthModule],
  controllers: [
    LlmSettingsController,
    GameDatabaseController,
    PreferencesController,
  ],
  providers: [
    LlmSettingsService,
    LlmKeyCryptoService,
    GameDatabaseStatusService,
    PreferencesService,
    VisionService,
    VisionProviderRegistry,
    GeminiVisionProvider,
    OpenAiVisionProvider,
    CustomVisionProvider,
    { provide: VisionHttpClient, useClass: FetchVisionHttpClient },
  ],
  exports: [LlmSettingsService, VisionService],
})
export class SettingsModule {}
