import { Injectable } from '@nestjs/common';
import { VisionProviderError } from './vision.errors';
import type { VisionProvider, VisionProviderId } from './vision-provider';
import { GeminiVisionProvider } from './gemini-vision.provider';
import { OpenAiVisionProvider } from './openai-vision.provider';

/**
 * The provider lookup the pipeline depends on. Concrete providers are
 * registered here at construction; adding a provider is one class plus one
 * `register` line (and one module provider line) with no pipeline change.
 */
@Injectable()
export class VisionProviderRegistry {
  private readonly providers = new Map<VisionProviderId, VisionProvider>();

  constructor(gemini: GeminiVisionProvider, openai: OpenAiVisionProvider) {
    this.register(gemini);
    this.register(openai);
  }

  private register(provider: VisionProvider): void {
    this.providers.set(provider.id, provider);
  }

  ids(): VisionProviderId[] {
    return [...this.providers.keys()];
  }

  has(id: string): id is VisionProviderId {
    return this.providers.has(id as VisionProviderId);
  }

  get(id: VisionProviderId): VisionProvider {
    const provider = this.providers.get(id);
    if (provider === undefined) {
      throw new VisionProviderError('unknown_provider');
    }
    return provider;
  }
}
