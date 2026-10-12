import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LlmSetting } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import type { PutLlmSettingsDto } from '../../src/settings/dto/put-llm-settings.dto';
import { LlmKeyCryptoService } from '../../src/settings/llm-key-crypto.service';
import { LlmSettingsService } from '../../src/settings/llm-settings.service';
import { VisionProviderRegistry } from '../../src/settings/vision/vision-provider.registry';

const PROVIDERS = [
  { id: 'custom', label: 'Custom (OpenAI-compatible)', defaultModel: '' },
] as const;

const URL = 'http://localhost:11434/v1';

function row(overrides: Partial<LlmSetting> = {}): LlmSetting {
  return {
    id: 1,
    provider: 'custom',
    model: null,
    baseUrl: null,
    apiKeyCiphertext: null,
    updatedAt: new Date('2026-10-06T00:00:00Z'),
    ...overrides,
  };
}

interface Mocks {
  findUnique: jest.Mock;
  upsert: jest.Mock;
  encrypt: jest.Mock;
  decrypt: jest.Mock;
  configGet: jest.Mock;
  has: jest.Mock;
}

function createService(env: Record<string, string | undefined> = {}): {
  service: LlmSettingsService;
  mocks: Mocks;
} {
  const mocks: Mocks = {
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue(row()),
    encrypt: jest.fn((value: string) => `v1:enc:${value}`),
    decrypt: jest.fn((value: string) => value.replace('v1:enc:', '')),
    configGet: jest.fn((key: string) => env[key]),
    has: jest.fn((id: string) =>
      PROVIDERS.some((provider) => provider.id === id),
    ),
  };
  const registry = {
    ids: jest.fn(() => PROVIDERS.map((provider) => provider.id)),
    has: mocks.has,
    get: jest.fn((id: string) =>
      PROVIDERS.find((provider) => provider.id === id),
    ),
  } as unknown as VisionProviderRegistry;
  const service = new LlmSettingsService(
    {
      llmSetting: { findUnique: mocks.findUnique, upsert: mocks.upsert },
    } as unknown as PrismaService,
    {
      encrypt: mocks.encrypt,
      decrypt: mocks.decrypt,
    } as unknown as LlmKeyCryptoService,
    registry,
    { get: mocks.configGet } as unknown as ConfigService,
  );
  return { service, mocks };
}

function saveArgs(mocks: Mocks): Record<string, unknown> {
  return (mocks.upsert.mock.calls as unknown[][])[0]?.[0] as Record<
    string,
    unknown
  >;
}

describe('LlmSettingsService (unit)', () => {
  it('getPublic falls back to the env key with no base URL', async () => {
    const { service } = createService({ CUSTOM_API_KEY: 'env-custom' });

    await expect(service.getPublic()).resolves.toEqual({
      provider: 'custom',
      model: '',
      baseUrl: null,
      keyPresent: true,
      importEnabled: false,
      availableProviders: [
        { id: 'custom', label: 'Custom (OpenAI-compatible)', defaultModel: '' },
      ],
      updatedAt: null,
    });
  });

  it('getPublic returns the stored base URL and enabled import for a configured custom row', async () => {
    const { service, mocks } = createService();
    mocks.findUnique.mockResolvedValue(
      row({
        provider: 'custom',
        baseUrl: URL,
        apiKeyCiphertext: 'v1:enc:db-key',
      }),
    );

    await expect(service.getPublic()).resolves.toMatchObject({
      provider: 'custom',
      baseUrl: URL,
      keyPresent: true,
      importEnabled: true,
    });
  });

  it.each(['gemini', 'openai', 'anthropic'])(
    'getPublic resolves a legacy %s row to custom, unused, not configured',
    async (id) => {
      const { service, mocks } = createService();
      mocks.findUnique.mockResolvedValue(
        row({
          provider: id,
          model: 'old-model',
          baseUrl: null,
          apiKeyCiphertext: 'v1:enc:old-key',
        }),
      );

      await expect(service.getPublic()).resolves.toMatchObject({
        provider: 'custom',
        model: '',
        baseUrl: null,
        keyPresent: false,
        importEnabled: false,
      });
      await expect(service.resolveActive()).resolves.toBeNull();
      expect(mocks.decrypt).not.toHaveBeenCalled();
    },
  );

  it('getPublic reports no key and import disabled when nothing is set', async () => {
    const { service } = createService();

    await expect(service.getPublic()).resolves.toMatchObject({
      keyPresent: false,
      importEnabled: false,
      updatedAt: null,
    });
  });

  it('ignores LLM_PROVIDER and honours LLM_MODEL + CUSTOM_API_KEY', async () => {
    const { service } = createService({
      LLM_PROVIDER: 'openai',
      LLM_MODEL: 'llava:13b',
      CUSTOM_API_KEY: 'env-custom',
    });

    await expect(service.getPublic()).resolves.toMatchObject({
      provider: 'custom',
      model: 'llava:13b',
      keyPresent: true,
    });
  });

  it('prefers the stored row model over LLM_MODEL', async () => {
    const { service, mocks } = createService({ LLM_MODEL: 'env-model' });
    mocks.findUnique.mockResolvedValue(
      row({ provider: 'custom', model: 'stored-model' }),
    );

    await expect(service.getPublic()).resolves.toMatchObject({
      provider: 'custom',
      model: 'stored-model',
    });
  });

  it('decrypts the stored key and prefers it over the env key', async () => {
    const { service, mocks } = createService({ CUSTOM_API_KEY: 'env-custom' });
    mocks.findUnique.mockResolvedValue(
      row({
        provider: 'custom',
        baseUrl: URL,
        apiKeyCiphertext: 'v1:enc:db-key',
      }),
    );

    await expect(service.resolveActive()).resolves.toEqual({
      provider: 'custom',
      model: '',
      apiKey: 'db-key',
      baseUrl: URL,
    });
    expect(mocks.decrypt).toHaveBeenCalledWith('v1:enc:db-key');
  });

  it('treats a decrypt failure as absent and falls back to env', async () => {
    const { service, mocks } = createService({ CUSTOM_API_KEY: 'env-custom' });
    mocks.findUnique.mockResolvedValue(
      row({ provider: 'custom', baseUrl: URL, apiKeyCiphertext: 'v1:broken' }),
    );
    mocks.decrypt.mockImplementation(() => {
      throw new Error('auth tag mismatch');
    });

    await expect(service.resolveActive()).resolves.toMatchObject({
      apiKey: 'env-custom',
    });
  });

  it('resolveActive is null and isConfigured false with an env key but no base URL', async () => {
    const { service } = createService({ CUSTOM_API_KEY: 'env-custom' });

    await expect(service.resolveActive()).resolves.toBeNull();
    await expect(service.isConfigured()).resolves.toBe(false);
  });

  it('resolveActive is null for a custom row with a base URL but no key', async () => {
    const { service, mocks } = createService();
    mocks.findUnique.mockResolvedValue(
      row({ provider: 'custom', baseUrl: URL }),
    );

    await expect(service.resolveActive()).resolves.toBeNull();
  });

  it('isConfigured is true with an env key and a custom row base URL', async () => {
    const { service, mocks } = createService({ CUSTOM_API_KEY: 'env-custom' });
    mocks.findUnique.mockResolvedValue(
      row({ provider: 'custom', baseUrl: URL }),
    );

    await expect(service.isConfigured()).resolves.toBe(true);
  });

  it('save encrypts the key and upserts the singleton row', async () => {
    const { service, mocks } = createService();
    mocks.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(
      row({
        provider: 'custom',
        model: 'llava:7b',
        baseUrl: URL,
        apiKeyCiphertext: 'v1:enc:new-key',
      }),
    );

    const result = await service.save({
      provider: 'custom',
      baseUrl: `${URL}/`,
      model: 'llava:7b',
      apiKey: 'new-key',
    });

    expect(mocks.encrypt).toHaveBeenCalledWith('new-key');
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      create: {
        id: 1,
        provider: 'custom',
        model: 'llava:7b',
        baseUrl: URL,
        apiKeyCiphertext: 'v1:enc:new-key',
      },
      update: {
        provider: 'custom',
        model: 'llava:7b',
        baseUrl: URL,
        apiKeyCiphertext: 'v1:enc:new-key',
      },
    });
    expect(result).toMatchObject({ provider: 'custom', keyPresent: true });
    expect(JSON.stringify(result)).not.toContain('new-key');
  });

  it('save keeps the stored base URL and key when both are omitted', async () => {
    const { service, mocks } = createService();
    mocks.findUnique.mockResolvedValue(
      row({ provider: 'custom', baseUrl: URL }),
    );

    await service.save({ provider: 'custom' });

    expect(saveArgs(mocks).update).toEqual({ provider: 'custom' });
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });

  it('save resets the legacy row key and model when switching to custom', async () => {
    const { service, mocks } = createService();
    mocks.findUnique
      .mockResolvedValueOnce(
        row({
          provider: 'gemini',
          model: 'gemini-x',
          apiKeyCiphertext: 'v1:enc:gemini-key',
        }),
      )
      .mockResolvedValueOnce(
        row({
          provider: 'custom',
          model: null,
          baseUrl: URL,
          apiKeyCiphertext: null,
        }),
      );

    await service.save({ provider: 'custom', baseUrl: URL });

    expect(saveArgs(mocks).update).toEqual({
      provider: 'custom',
      model: null,
      baseUrl: URL,
      apiKeyCiphertext: null,
    });
    // The previous provider's key must never be decrypted or reused.
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it('save keeps explicit values when switching from a legacy row', async () => {
    const { service, mocks } = createService();
    mocks.findUnique
      .mockResolvedValueOnce(
        row({ provider: 'gemini', apiKeyCiphertext: 'v1:enc:gemini-key' }),
      )
      .mockResolvedValueOnce(
        row({
          provider: 'custom',
          model: 'llava:7b',
          baseUrl: URL,
          apiKeyCiphertext: 'v1:enc:new-key',
        }),
      );

    await service.save({
      provider: 'custom',
      baseUrl: URL,
      model: 'llava:7b',
      apiKey: 'new-key',
    });

    expect(mocks.encrypt).toHaveBeenCalledWith('new-key');
    expect(saveArgs(mocks).update).toEqual({
      provider: 'custom',
      model: 'llava:7b',
      baseUrl: URL,
      apiKeyCiphertext: 'v1:enc:new-key',
    });
  });

  it('save with an empty apiKey clears the stored key', async () => {
    const { service, mocks } = createService();
    mocks.findUnique.mockResolvedValue(
      row({ provider: 'custom', baseUrl: URL }),
    );

    await service.save({ provider: 'custom', apiKey: '' });

    expect(saveArgs(mocks).update).toEqual({
      provider: 'custom',
      apiKeyCiphertext: null,
    });
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });

  it('save with an empty model clears the override', async () => {
    const { service, mocks } = createService();
    mocks.findUnique.mockResolvedValue(
      row({ provider: 'custom', baseUrl: URL, model: 'stored-model' }),
    );

    await service.save({ provider: 'custom', model: '' });

    expect(saveArgs(mocks).update).toEqual({
      provider: 'custom',
      model: null,
    });
  });

  it.each(['bogus', 'gemini', 'openai'])(
    'save rejects the removed/unknown provider %s',
    async (id) => {
      const { service } = createService();

      await expect(
        service.save({ provider: id } as unknown as PutLlmSettingsDto),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('save normalizes the custom base URL (trailing slash stripped)', async () => {
    const { service, mocks } = createService();

    await service.save({
      provider: 'custom',
      baseUrl: 'http://localhost:11434/v1/',
      apiKey: 'custom-key',
    });

    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      create: {
        id: 1,
        provider: 'custom',
        model: null,
        baseUrl: 'http://localhost:11434/v1',
        apiKeyCiphertext: 'v1:enc:custom-key',
      },
      update: {
        provider: 'custom',
        baseUrl: 'http://localhost:11434/v1',
        apiKeyCiphertext: 'v1:enc:custom-key',
      },
    });
  });

  it('save rejects custom without a base URL when switching provider', async () => {
    const { service, mocks } = createService();
    mocks.findUnique.mockResolvedValue(row({ provider: 'gemini' }));

    await expect(service.save({ provider: 'custom' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('save rejects custom without a base URL when no row exists', async () => {
    const { service, mocks } = createService();

    await expect(service.save({ provider: 'custom' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('save rejects an empty custom base URL', async () => {
    const { service, mocks } = createService();

    await expect(
      service.save({ provider: 'custom', baseUrl: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('save rejects a relative custom base URL', async () => {
    const { service, mocks } = createService();

    await expect(
      service.save({ provider: 'custom', baseUrl: 'localhost:11434/v1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('save rejects a non-http custom base URL', async () => {
    const { service, mocks } = createService();

    await expect(
      service.save({ provider: 'custom', baseUrl: 'ftp://x/v1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('resolveActive includes the base URL for the custom provider', async () => {
    const { service, mocks } = createService();
    mocks.findUnique.mockResolvedValue(
      row({
        provider: 'custom',
        baseUrl: URL,
        apiKeyCiphertext: 'v1:enc:custom-key',
      }),
    );

    await expect(service.resolveActive()).resolves.toEqual({
      provider: 'custom',
      model: '',
      apiKey: 'custom-key',
      baseUrl: URL,
    });
  });
});
