import { VisionProviderRegistry } from '../../src/settings/vision/vision-provider.registry';
import { VisionProviderError } from '../../src/settings/vision/vision.errors';
import type {
  RecognizedItem,
  VisionProvider,
  VisionProviderConfig,
  VisionRecognitionInput,
} from '../../src/settings/vision/vision-provider';
import type { GeminiVisionProvider } from '../../src/settings/vision/gemini-vision.provider';
import type { OpenAiVisionProvider } from '../../src/settings/vision/openai-vision.provider';

function fakeProvider(id: 'gemini' | 'openai'): VisionProvider {
  return {
    id,
    label: `${id} label`,
    defaultModel: `${id}-default`,
    recognize: (
      _input: VisionRecognitionInput,
      _config: VisionProviderConfig,
    ): Promise<RecognizedItem[]> => Promise.resolve([]),
  };
}

function createRegistry(): {
  registry: VisionProviderRegistry;
  gemini: VisionProvider;
  openai: VisionProvider;
} {
  const gemini = fakeProvider('gemini');
  const openai = fakeProvider('openai');
  const registry = new VisionProviderRegistry(
    gemini as unknown as GeminiVisionProvider,
    openai as unknown as OpenAiVisionProvider,
  );
  return { registry, gemini, openai };
}

describe('VisionProviderRegistry (unit)', () => {
  it('lists the registered provider ids', () => {
    const { registry } = createRegistry();

    expect(registry.ids()).toEqual(['gemini', 'openai']);
  });

  it('knows which ids are registered', () => {
    const { registry } = createRegistry();

    expect(registry.has('gemini')).toBe(true);
    expect(registry.has('openai')).toBe(true);
    expect(registry.has('anthropic')).toBe(false);
  });

  it('returns the provider for a known id', () => {
    const { registry, openai } = createRegistry();

    expect(registry.get('openai')).toBe(openai);
  });

  it('throws unknown_provider for an unregistered id', () => {
    const { registry } = createRegistry();

    expect(() => registry.get('bogus' as 'gemini')).toThrow(
      VisionProviderError,
    );
    try {
      registry.get('bogus' as 'gemini');
    } catch (error) {
      expect((error as VisionProviderError).code).toBe('unknown_provider');
    }
  });
});
