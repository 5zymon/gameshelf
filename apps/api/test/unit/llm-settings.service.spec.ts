import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LlmSetting } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import type { PutLlmSettingsDto } from '../../src/settings/dto/put-llm-settings.dto';
import { LlmKeyCryptoService } from '../../src/settings/llm-key-crypto.service';
import { LlmSettingsService } from '../../src/settings/llm-settings.service';
import { VisionProviderRegistry } from '../../src/settings/vision/vision-provider.registry';

const PROVIDERS = [
  { id: 'gemini', label: 'Google Gemini', defaultModel: 'gemini-3.8-flash' },
  { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o-mini' },
] as const;

function row(overrides: Partial<LlmSetting> = {}): LlmSetting {
  return {
    id: 1,
    provider: 'gemini',
    model: null,
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
  it('getPublic falls back to the provider env key and default model', async () => {
    const { service } = createService({ GEMINI_API_KEY: 'env-gemini' });

    await expect(service.getPublic()).resolves.toEqual({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      keyPresent: true,
      importEnabled: true,
      availableProviders: [
        {
          id: 'gemini',
          label: 'Google Gemini',
          defaultModel: 'gemini-3.8-flash',
        },
        { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o-mini' },
      ],
      updatedAt: null,
    });
  });

  it('getPublic reports no key and import disabled when nothing is set', async () => {
    const { service } = createService();

    await expect(service.getPublic()).resolves.toMatchObject({
      keyPresent: false,
      importEnabled: false,
      updatedAt: null,
    });
  });

  it('honours LLM_PROVIDER and LLM_MODEL env overrides', async () => {
    const { service } = createService({
      LLM_PROVIDER: 'openai',
      LLM_MODEL: 'gpt-custom',
      OPENAI_API_KEY: 'env-openai',
    });

    await expect(service.getPublic()).resolves.toMatchObject({
      provider: 'openai',
      model: 'gpt-custom',
      keyPresent: true,
    });
  });

  it('prefers the stored row provider/model over env', async () => {
    const { service, mocks } = createService({
      LLM_PROVIDER: 'gemini',
      LLM_MODEL: 'env-model',
      GEMINI_API_KEY: 'env-gemini',
    });
    mocks.findUnique.mockResolvedValue(
      row({ provider: 'openai', model: 'stored-model' }),
    );

    await expect(service.getPublic()).resolves.toMatchObject({
      provider: 'openai',
      model: 'stored-model',
    });
  });

  it('decrypts the stored key and prefers it over the env key', async () => {
    const { service, mocks } = createService({ GEMINI_API_KEY: 'env-gemini' });
    mocks.findUnique.mockResolvedValue(
      row({ provider: 'gemini', apiKeyCiphertext: 'v1:enc:db-key' }),
    );

    await expect(service.resolveActive()).resolves.toEqual({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      apiKey: 'db-key',
    });
    expect(mocks.decrypt).toHaveBeenCalledWith('v1:enc:db-key');
  });

  it('ignores a stored key when the row provider is unknown', async () => {
    const { service, mocks } = createService({ GEMINI_API_KEY: 'env-gemini' });
    mocks.findUnique.mockResolvedValue(
      row({ provider: 'anthropic', apiKeyCiphertext: 'v1:enc:db-key' }),
    );

    await expect(service.resolveActive()).resolves.toMatchObject({
      provider: 'gemini',
      apiKey: 'env-gemini',
    });
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it('treats a decrypt failure as absent and falls back to env', async () => {
    const { service, mocks } = createService({ GEMINI_API_KEY: 'env-gemini' });
    mocks.findUnique.mockResolvedValue(
      row({ provider: 'gemini', apiKeyCiphertext: 'v1:broken' }),
    );
    mocks.decrypt.mockImplementation(() => {
      throw new Error('auth tag mismatch');
    });

    await expect(service.resolveActive()).resolves.toMatchObject({
      apiKey: 'env-gemini',
    });
  });

  it('resolveActive is null and isConfigured false with no key', async () => {
    const { service } = createService();

    await expect(service.resolveActive()).resolves.toBeNull();
    await expect(service.isConfigured()).resolves.toBe(false);
  });

  it('isConfigured is true when the active provider has an env key', async () => {
    const { service } = createService({ GEMINI_API_KEY: 'env-gemini' });

    await expect(service.isConfigured()).resolves.toBe(true);
  });

  it('save encrypts the key and upserts the singleton row', async () => {
    const { service, mocks } = createService();
    mocks.findUnique.mockResolvedValue(
      row({
        provider: 'openai',
        model: 'gpt-x',
        apiKeyCiphertext: 'v1:enc:new-key',
      }),
    );

    const result = await service.save({
      provider: 'openai',
      model: 'gpt-x',
      apiKey: 'new-key',
    });

    expect(mocks.encrypt).toHaveBeenCalledWith('new-key');
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      create: {
        id: 1,
        provider: 'openai',
        model: 'gpt-x',
        apiKeyCiphertext: 'v1:enc:new-key',
      },
      update: {
        provider: 'openai',
        model: 'gpt-x',
        apiKeyCiphertext: 'v1:enc:new-key',
      },
    });
    expect(result).toMatchObject({ provider: 'openai', keyPresent: true });
    expect(JSON.stringify(result)).not.toContain('new-key');
  });

  it('save omits apiKey from the update to keep the stored key', async () => {
    const { service, mocks } = createService();
    mocks.findUnique.mockResolvedValue(row({ provider: 'gemini' }));

    await service.save({ provider: 'gemini' });

    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      create: {
        id: 1,
        provider: 'gemini',
        model: null,
        apiKeyCiphertext: null,
      },
      update: { provider: 'gemini' },
    });
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });

  it('save clears the previous provider key/model when the provider changes', async () => {
    const { service, mocks } = createService({ OPENAI_API_KEY: 'env-openai' });
    mocks.findUnique
      .mockResolvedValueOnce(
        row({
          provider: 'gemini',
          model: 'gemini-x',
          apiKeyCiphertext: 'v1:enc:gemini-key',
        }),
      )
      .mockResolvedValueOnce(
        row({ provider: 'openai', model: null, apiKeyCiphertext: null }),
      );

    const result = await service.save({ provider: 'openai' });

    expect(saveArgs(mocks).update).toEqual({
      provider: 'openai',
      model: null,
      apiKeyCiphertext: null,
    });
    // The previous provider's key must never be decrypted or reused.
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-mini',
      keyPresent: true,
    });
  });

  it('save keeps an explicit key/model when the provider changes', async () => {
    const { service, mocks } = createService();
    mocks.findUnique
      .mockResolvedValueOnce(
        row({ provider: 'gemini', apiKeyCiphertext: 'v1:enc:gemini-key' }),
      )
      .mockResolvedValueOnce(
        row({
          provider: 'openai',
          model: 'gpt-new',
          apiKeyCiphertext: 'v1:enc:new-key',
        }),
      );

    await service.save({
      provider: 'openai',
      model: 'gpt-new',
      apiKey: 'new-key',
    });

    expect(mocks.encrypt).toHaveBeenCalledWith('new-key');
    expect(saveArgs(mocks).update).toEqual({
      provider: 'openai',
      model: 'gpt-new',
      apiKeyCiphertext: 'v1:enc:new-key',
    });
  });

  it('save with an empty apiKey clears the stored key', async () => {
    const { service, mocks } = createService();

    await service.save({ provider: 'gemini', apiKey: '' });

    expect(saveArgs(mocks).update).toEqual({
      provider: 'gemini',
      apiKeyCiphertext: null,
    });
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });

  it('save with an empty model clears the override', async () => {
    const { service, mocks } = createService();

    await service.save({ provider: 'gemini', model: '' });

    expect(saveArgs(mocks).update).toEqual({
      provider: 'gemini',
      model: null,
    });
  });

  it('save rejects an unknown provider', async () => {
    const { service } = createService();

    await expect(
      service.save({ provider: 'bogus' } as unknown as PutLlmSettingsDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
