import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LlmSetting } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { PutLlmSettingsDto } from './dto/put-llm-settings.dto';
import {
  LlmProviderSummaryModel,
  LlmSettingsModel,
} from './dto/llm-settings.model';
import { LlmKeyCryptoService } from './llm-key-crypto.service';
import { VisionProviderRegistry } from './vision/vision-provider.registry';
import {
  providerApiKeyEnvVar,
  type VisionProviderId,
} from './vision/vision-provider';

const SINGLETON_ID = 1;

export interface ActiveLlmConfig {
  provider: VisionProviderId;
  model: string;
  apiKey: string;
}

/**
 * Reads and writes the singleton LLM settings row (`llm_settings.id = 1`) and
 * resolves the effective provider/model/key.
 *
 * Key precedence for the active provider:
 *   1. the encrypted `api_key_ciphertext` on the row (only when the row's
 *      provider matches the active provider), then
 *   2. the provider's env var (`GEMINI_API_KEY` / `OPENAI_API_KEY`), then
 *   3. none -> recognition is disabled.
 */
@Injectable()
export class LlmSettingsService {
  private readonly logger = new Logger(LlmSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: LlmKeyCryptoService,
    private readonly registry: VisionProviderRegistry,
    private readonly config: ConfigService,
  ) {}

  async getPublic(): Promise<LlmSettingsModel> {
    const row = await this.readRow();
    const provider = this.resolveProviderId(row);
    const apiKey = this.resolveApiKey(provider, row);
    const keyPresent = apiKey !== null;
    return {
      provider,
      model: this.resolveModel(provider, row),
      keyPresent,
      importEnabled: keyPresent,
      availableProviders: this.availableProviders(),
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /** Effective config, or `null` when no key is available for the provider. */
  async resolveActive(): Promise<ActiveLlmConfig | null> {
    const row = await this.readRow();
    const provider = this.resolveProviderId(row);
    const apiKey = this.resolveApiKey(provider, row);
    if (apiKey === null) {
      return null;
    }
    return { provider, model: this.resolveModel(provider, row), apiKey };
  }

  async isConfigured(): Promise<boolean> {
    return (await this.resolveActive()) !== null;
  }

  async save(dto: PutLlmSettingsDto): Promise<LlmSettingsModel> {
    if (!this.registry.has(dto.provider)) {
      throw new BadRequestException('Unknown LLM provider');
    }
    const provider = dto.provider;

    // A key/model belongs to the provider that stored it. When this request
    // switches provider, reset both unless the request supplies replacements,
    // so the previous provider's secret is never sent to the new backend.
    const existing = await this.readRow();
    const switchesProvider =
      existing !== null && existing.provider !== provider;

    const model =
      dto.model === undefined
        ? switchesProvider
          ? null
          : undefined
        : dto.model.trim() || null;
    const ciphertext =
      dto.apiKey === undefined
        ? switchesProvider
          ? null
          : undefined
        : dto.apiKey.trim() === ''
          ? null
          : this.crypto.encrypt(dto.apiKey.trim());

    await this.prisma.llmSetting.upsert({
      where: { id: SINGLETON_ID },
      create: {
        id: SINGLETON_ID,
        provider,
        model: model ?? null,
        apiKeyCiphertext: ciphertext ?? null,
      },
      update: {
        provider,
        ...(model !== undefined && { model }),
        ...(ciphertext !== undefined && { apiKeyCiphertext: ciphertext }),
      },
    });

    const result = await this.getPublic();
    // Log provider/model/presence only — never the key or its ciphertext.
    this.logger.log(
      `LLM settings updated: provider=${result.provider} model=${result.model} keyPresent=${String(result.keyPresent)}`,
    );
    return result;
  }

  private readRow(): Promise<LlmSetting | null> {
    return this.prisma.llmSetting.findUnique({ where: { id: SINGLETON_ID } });
  }

  /** DB row provider if valid, else `LLM_PROVIDER`, else the default (`gemini`). */
  private resolveProviderId(row: LlmSetting | null): VisionProviderId {
    if (row !== null && this.registry.has(row.provider)) {
      return row.provider;
    }
    const envProvider = this.config.get<string>('LLM_PROVIDER')?.trim();
    if (envProvider !== undefined && this.registry.has(envProvider)) {
      return envProvider;
    }
    return 'gemini';
  }

  /** Row model (same provider only), else `LLM_MODEL`, else the default model. */
  private resolveModel(
    provider: VisionProviderId,
    row: LlmSetting | null,
  ): string {
    const rowModel =
      row !== null && row.provider === provider ? row.model?.trim() : undefined;
    if (rowModel !== undefined && rowModel !== '') {
      return rowModel;
    }
    const envModel = this.config.get<string>('LLM_MODEL')?.trim();
    if (envModel !== undefined && envModel !== '') {
      return envModel;
    }
    return this.registry.get(provider).defaultModel;
  }

  /**
   * Decrypts the row's key when it belongs to the active provider, falling
   * back to the provider env var. A decrypt failure is treated as absent (a
   * rotated secret must not break settings reads) and logged without secrets.
   */
  private resolveApiKey(
    provider: VisionProviderId,
    row: LlmSetting | null,
  ): string | null {
    if (
      row !== null &&
      row.provider === provider &&
      row.apiKeyCiphertext !== null
    ) {
      try {
        const decrypted = this.crypto.decrypt(row.apiKeyCiphertext).trim();
        if (decrypted !== '') {
          return decrypted;
        }
      } catch {
        this.logger.warn(
          `Stored LLM key for provider ${provider} could not be decrypted; treating it as absent`,
        );
      }
    }
    const envKey = this.config.get<string>(providerApiKeyEnvVar(provider));
    const trimmed = envKey?.trim();
    return trimmed !== undefined && trimmed !== '' ? trimmed : null;
  }

  private availableProviders(): LlmProviderSummaryModel[] {
    return this.registry.ids().map((id) => {
      const provider = this.registry.get(id);
      return { id, label: provider.label, defaultModel: provider.defaultModel };
    });
  }
}
