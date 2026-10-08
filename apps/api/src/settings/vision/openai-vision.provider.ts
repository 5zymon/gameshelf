import { Injectable, Logger } from '@nestjs/common';
import { VisionHttpClient } from './vision-http.client';
import { recognizeOpenAiCompatible } from './openai-compatible';
import {
  DEFAULT_OPENAI_MODEL,
  truncateForLog,
  type VisionProvider,
  type VisionProviderConfig,
  type VisionRecognitionInput,
  type VisionRecognitionResult,
} from './vision-provider';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

@Injectable()
export class OpenAiVisionProvider implements VisionProvider {
  readonly id = 'openai' as const;
  readonly label = 'OpenAI';
  readonly defaultModel = DEFAULT_OPENAI_MODEL;

  private readonly logger = new Logger(OpenAiVisionProvider.name);

  constructor(private readonly http: VisionHttpClient) {}

  async recognize(
    input: VisionRecognitionInput,
    config: VisionProviderConfig,
  ): Promise<VisionRecognitionResult> {
    const { result, rawText } = await recognizeOpenAiCompatible(
      this.http,
      OPENAI_ENDPOINT,
      config,
      input,
    );
    this.logger.debug(
      `OpenAI raw recognition response: ${truncateForLog(rawText)}`,
    );
    return result;
  }
}
