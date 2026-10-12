import { VisionProviderRegistry } from '../../src/settings/vision/vision-provider.registry';
import { VisionProviderError } from '../../src/settings/vision/vision.errors';
import type {
  VisionProvider,
  VisionProviderConfig,
  VisionRecognitionInput,
  VisionRecognitionResult,
} from '../../src/settings/vision/vision-provider';
import type { CustomVisionProvider } from '../../src/settings/vision/custom-vision.provider';

function fakeProvider(id: 'custom'): VisionProvider {
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
  custom: VisionProvider;
} {
  const custom = fakeProvider('custom');
  const registry = new VisionProviderRegistry(
    custom as unknown as CustomVisionProvider,
  );
  return { registry, custom };
}

describe('VisionProviderRegistry (unit)', () => {
  it('lists the registered provider ids', () => {
    const { registry } = createRegistry();

    expect(registry.ids()).toEqual(['custom']);
  });

  it('knows which ids are registered', () => {
    const { registry } = createRegistry();

    expect(registry.has('custom')).toBe(true);
    expect(registry.has('gemini')).toBe(false);
    expect(registry.has('openai')).toBe(false);
    expect(registry.has('anthropic')).toBe(false);
  });

  it('returns the custom provider for its id', () => {
    const { registry, custom } = createRegistry();

    expect(registry.get('custom')).toBe(custom);
  });

  it('throws unknown_provider for an unregistered id', () => {
    const { registry } = createRegistry();

    expect(() => registry.get('gemini' as 'custom')).toThrow(
      VisionProviderError,
    );
    try {
      registry.get('gemini' as 'custom');
    } catch (error) {
      expect((error as VisionProviderError).code).toBe('unknown_provider');
    }
  });
});
