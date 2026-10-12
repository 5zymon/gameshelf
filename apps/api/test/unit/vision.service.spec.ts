import { LlmSettingsService } from '../../src/settings/llm-settings.service';
import { VisionProviderRegistry } from '../../src/settings/vision/vision-provider.registry';
import {
  VisionProviderError,
  VisionUnavailableError,
} from '../../src/settings/vision/vision.errors';
import { VisionService } from '../../src/settings/vision/vision.service';

interface Mocks {
  resolveActive: jest.Mock;
  getPublic: jest.Mock;
  get: jest.Mock;
  recognize: jest.Mock;
}

function createService(): { service: VisionService; mocks: Mocks } {
  const mocks: Mocks = {
    resolveActive: jest.fn(),
    getPublic: jest.fn(),
    get: jest.fn(),
    recognize: jest.fn(),
  };
  const settings = {
    resolveActive: mocks.resolveActive,
    getPublic: mocks.getPublic,
  } as unknown as LlmSettingsService;
  const registry = { get: mocks.get } as unknown as VisionProviderRegistry;
  return { service: new VisionService(settings, registry), mocks };
}

describe('VisionService (unit)', () => {
  it('recognize throws VisionUnavailableError when no key is configured', async () => {
    const { service, mocks } = createService();
    mocks.resolveActive.mockResolvedValue(null);

    await expect(
      service.recognize({ image: Buffer.from('x'), mimeType: 'image/png' }),
    ).rejects.toBeInstanceOf(VisionUnavailableError);
  });

  it('recognize passes the base URL through for the custom provider', async () => {
    const { service, mocks } = createService();
    mocks.resolveActive.mockResolvedValue({
      provider: 'custom',
      model: 'llava:7b',
      apiKey: 'key-custom',
      baseUrl: 'http://localhost:11434/v1',
    });
    mocks.get.mockReturnValue({ recognize: mocks.recognize });
    mocks.recognize.mockResolvedValue({ items: [], countVisible: null });

    await service.recognize({
      image: Buffer.from('x'),
      mimeType: 'image/png',
    });

    expect(mocks.get).toHaveBeenCalledWith('custom');
    expect(mocks.recognize).toHaveBeenCalledWith(
      { image: expect.any(Buffer) as Buffer, mimeType: 'image/png' },
      {
        apiKey: 'key-custom',
        model: 'llava:7b',
        baseUrl: 'http://localhost:11434/v1',
      },
    );
  });

  it('test reports not_configured with 200-style result when no key is set', async () => {
    const { service, mocks } = createService();
    mocks.resolveActive.mockResolvedValue(null);
    mocks.getPublic.mockResolvedValue({ provider: 'custom', model: '' });

    await expect(service.test()).resolves.toEqual({
      ok: false,
      code: 'not_configured',
      provider: 'custom',
      model: '',
      message: 'No LLM base URL or API key is configured',
    });
  });

  it('test sends a real 1x1 PNG and reports ok', async () => {
    const { service, mocks } = createService();
    mocks.resolveActive.mockResolvedValue({
      provider: 'custom',
      model: 'llava:7b',
      apiKey: 'key',
      baseUrl: 'http://localhost:11434/v1',
    });
    mocks.get.mockReturnValue({ recognize: mocks.recognize });
    mocks.recognize.mockResolvedValue({ items: [], countVisible: null });

    const result = await service.test();

    expect(result.ok).toBe(true);
    expect(result.code).toBe('ok');
    const [input] = mocks.recognize.mock.calls[0] as [
      { image: Buffer; mimeType: string },
    ];
    expect(input.mimeType).toBe('image/png');
    // PNG magic number.
    expect(input.image.subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    expect(mocks.recognize).toHaveBeenCalledWith(expect.anything(), {
      apiKey: 'key',
      model: 'llava:7b',
      baseUrl: 'http://localhost:11434/v1',
    });
  });

  it('test maps a provider error to its code without throwing', async () => {
    const { service, mocks } = createService();
    mocks.resolveActive.mockResolvedValue({
      provider: 'custom',
      model: 'llava:7b',
      apiKey: 'key',
      baseUrl: 'http://localhost:11434/v1',
    });
    mocks.get.mockReturnValue({ recognize: mocks.recognize });
    mocks.recognize.mockRejectedValue(
      new VisionProviderError(
        'unauthorized',
        'The provider rejected the API key',
      ),
    );

    await expect(service.test()).resolves.toEqual({
      ok: false,
      code: 'unauthorized',
      provider: 'custom',
      model: 'llava:7b',
      message: 'The provider rejected the API key',
    });
  });

  it('test maps an unexpected error to server_error', async () => {
    const { service, mocks } = createService();
    mocks.resolveActive.mockResolvedValue({
      provider: 'custom',
      model: 'llava:7b',
      apiKey: 'key',
      baseUrl: 'http://localhost:11434/v1',
    });
    mocks.get.mockReturnValue({ recognize: mocks.recognize });
    mocks.recognize.mockRejectedValue(new Error('boom'));

    const result = await service.test();

    expect(result.ok).toBe(false);
    expect(result.code).toBe('server_error');
  });
});
