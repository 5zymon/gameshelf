import { VisionProviderRegistry } from '../../src/settings/vision/vision-provider.registry';
import { VisionProviderError } from '../../src/settings/vision/vision.errors';
import type {
  VisionProvider,
  VisionProviderConfig,
  VisionRecognitionInput,
  VisionRecognitionResult,
} from '../../src/settings/vision/vision-provider';
import type { CustomVisionProvider } from '../../src/settings/vision/custom-vision.provider';
import type { GeminiVisionProvider } from '../../src/settings/vision/gemini-vision.provider';
import type { OpenAiVisionProvider } from '../../src/settings/vision/openai-vision.provider';

function fakeProvider(id: 'gemini' | 'openai' | 'custom'): VisionProvider {
  return {
    id,
    label: `${id} label`,
    defaultModel: `${id}-default`,
    recognize: (
      _input: VisionRecognitionInput,
      _config: VisionProviderConfig,
    ): Promise<VisionRecognitionResult> =>
      Promise.resolve({ items: [], countVisible: null }),
  };
}

function createRegistry(): {
  registry: VisionProviderRegistry;
  gemini: VisionProvider;
  openai: VisionProvider;
  custom: VisionProvider;
} {
  const gemini = fakeProvider('gemini');
  const openai = fakeProvider('openai');
  const custom = fakeProvider('custom');
  const registry = new VisionProviderRegistry(
    gemini as unknown as GeminiVisionProvider,
    openai as unknown as OpenAiVisionProvider,
    custom as unknown as CustomVisionProvider,
  );
  return { registry, gemini, openai, custom };
}

describe('VisionProviderRegistry (unit)', () => {
  it('lists the registered provider ids', () => {
    const { registry } = createRegistry();

    expect(registry.ids()).toEqual(['gemini', 'openai', 'custom']);
  });

  it('knows which ids are registered', () => {
    const { registry } = createRegistry();

    expect(registry.has('gemini')).toBe(true);
    expect(registry.has('openai')).toBe(true);
    expect(registry.has('custom')).toBe(true);
    expect(registry.has('anthropic')).toBe(false);
  });

  it('returns the provider for a known id', () => {
    const { registry, openai } = createRegistry();

    expect(registry.get('openai')).toBe(openai);
  });

  it('returns the custom provider for its id', () => {
    const { registry, custom } = createRegistry();

    expect(registry.get('custom')).toBe(custom);
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
