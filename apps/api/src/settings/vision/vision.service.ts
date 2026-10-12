import { Injectable } from '@nestjs/common';
import { LlmTestResultModel } from '../dto/llm-test-result.model';
import { LlmSettingsService } from '../llm-settings.service';
import { VisionProviderRegistry } from './vision-provider.registry';
import {
  VisionProviderError,
  VisionUnavailableError,
  type VisionTestCode,
} from './vision.errors';
import {
  type VisionRecognitionInput,
  type VisionRecognitionResult,
} from './vision-provider';

/** A real, valid 1x1 PNG used by `test()` so the call exercises the provider. */
const TEST_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
);
const TEST_MIME_TYPE = 'image/png';

/**
 * The only surface the import pipeline touches. It resolves the active
 * provider/key from settings and delegates to the registry, so the pipeline
 * is decoupled from concrete providers.
 */
@Injectable()
export class VisionService {
  constructor(
    private readonly settings: LlmSettingsService,
    private readonly registry: VisionProviderRegistry,
  ) {}

  /** Throws `VisionUnavailableError` when no provider key is configured. */
  async recognize(
    input: VisionRecognitionInput,
  ): Promise<VisionRecognitionResult> {
    const active = await this.settings.resolveActive();
    if (active === null) {
      throw new VisionUnavailableError();
    }
    const provider = this.registry.get(active.provider);
    return provider.recognize(input, {
      apiKey: active.apiKey,
      model: active.model,
      baseUrl: active.baseUrl,
    });
  }

  /**
   * Makes one real provider call with a 1x1 PNG and maps any failure to a
   * stable code. Never throws and never returns the key or upstream body.
   */
  async test(): Promise<LlmTestResultModel> {
    const active = await this.settings.resolveActive();
    if (active === null) {
      const settings = await this.settings.getPublic();
      return {
        ok: false,
        code: 'not_configured',
        provider: settings.provider,
        model: settings.model,
        message: 'No LLM base URL or API key is configured',
      };
    }
    const provider = this.registry.get(active.provider);
    try {
      await provider.recognize(
        { image: TEST_IMAGE, mimeType: TEST_MIME_TYPE },
        {
          apiKey: active.apiKey,
          model: active.model,
          baseUrl: active.baseUrl,
        },
      );
      return {
        ok: true,
        code: 'ok',
        provider: active.provider,
        model: active.model,
        message: 'The provider accepted the request',
      };
    } catch (error) {
      return {
        ok: false,
        code: this.toCode(error),
        provider: active.provider,
        model: active.model,
        message:
          error instanceof VisionProviderError
            ? error.message
            : 'The provider test failed unexpectedly',
      };
    }
  }

  private toCode(error: unknown): VisionTestCode {
    return error instanceof VisionProviderError ? error.code : 'server_error';
  }
}
