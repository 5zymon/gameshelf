import { Injectable, Logger } from '@nestjs/common';
import { VisionHttpClient } from './vision-http.client';
import { recognizeOpenAiCompatible } from './openai-compatible';
import { VisionProviderError } from './vision.errors';
import {
  truncateForLog,
  type VisionProvider,
  type VisionProviderConfig,
  type VisionRecognitionInput,
  type VisionRecognitionResult,
} from './vision-provider';

@Injectable()
export class CustomVisionProvider implements VisionProvider {
  readonly id = 'custom' as const;
  readonly label = 'Custom (OpenAI-compatible)';
  // No sensible default for a local/arbitrary model name; the user types it.
  readonly defaultModel = '';

  private readonly logger = new Logger(CustomVisionProvider.name);

  constructor(private readonly http: VisionHttpClient) {}

  async recognize(
    input: VisionRecognitionInput,
    config: VisionProviderConfig,
  ): Promise<VisionRecognitionResult> {
    const baseUrl = config.baseUrl?.trim();
    if (baseUrl === undefined || baseUrl === '') {
      // Defensive: settings validation guarantees a base URL for `custom`.
      throw new VisionProviderError(
        'bad_response',
        'The custom provider has no base URL configured',
      );
    }
    const { result, rawText } = await recognizeOpenAiCompatible(
      this.http,
      `${baseUrl}/chat/completions`,
      config,
      input,
    );
    this.logger.debug(
      `Custom raw recognition response: ${truncateForLog(rawText)}`,
    );
    return result;
  }
}
