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
  baseUrl?: string;
}

/**
 * Validates and normalizes a `custom` provider base URL. Returns the
 * canonical form (`origin + pathname`, trailing `/` stripped) or `null` when
 * the input is not an absolute `http://`/`https://` URL. Query and hash are
 * dropped.
 */
export function normalizeBaseUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.hostname === '') return null;
  return (url.origin + url.pathname).replace(/\/+$/, '');
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
    const baseUrl =
      provider === 'custom' ? (this.resolveBaseUrl(row) ?? null) : null;
    return {
      provider,
      model: this.resolveModel(provider, row),
      baseUrl,
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
    return {
      provider,
      model: this.resolveModel(provider, row),
      apiKey,
      ...(provider === 'custom' && { baseUrl: this.resolveBaseUrl(row) }),
    };
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

    // The base URL belongs to the `custom` provider only. It is required when
    // saving `custom` (a fixed endpoint for the built-ins is not overridable),
    // and must be omitted/empty for them.
    let baseUrl: string | null | undefined;
    if (provider === 'custom') {
      if (dto.baseUrl !== undefined) {
        const trimmed = dto.baseUrl.trim();
        if (trimmed === '') {
          throw new BadRequestException(
            'Base URL is required for the custom provider',
          );
        }
        const normalized = normalizeBaseUrl(trimmed);
        if (normalized === null) {
          throw new BadRequestException(
            'Base URL must be an absolute http:// or https:// URL',
          );
        }
        baseUrl = normalized;
      } else if (switchesProvider) {
        throw new BadRequestException(
          'Base URL is required for the custom provider',
        );
      } else {
        const stored = this.readStoredBaseUrl(existing);
        if (stored === undefined) {
          throw new BadRequestException(
            'Base URL is required for the custom provider',
          );
        }
        baseUrl = undefined; // keep the column as-is
      }
    } else {
      if (dto.baseUrl !== undefined && dto.baseUrl.trim() !== '') {
        throw new BadRequestException(
          'Base URL is only supported by the custom provider',
        );
      }
      baseUrl = null; // clear for the built-in providers
    }

    await this.prisma.llmSetting.upsert({
      where: { id: SINGLETON_ID },
      create: {
        id: SINGLETON_ID,
        provider,
        model: model ?? null,
        baseUrl: baseUrl ?? null,
        apiKeyCiphertext: ciphertext ?? null,
      },
      update: {
        provider,
        ...(model !== undefined && { model }),
        ...(baseUrl !== undefined && { baseUrl }),
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

  /** The existing row's base URL (custom rows only), for the save cross-check. */
  private readStoredBaseUrl(row: LlmSetting | null): string | undefined {
    const url = row?.provider === 'custom' ? row.baseUrl?.trim() : undefined;
    return url !== undefined && url !== '' ? url : undefined;
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

  /** The stored base URL (custom rows only), trimmed, or `undefined` when absent. */
  private resolveBaseUrl(row: LlmSetting | null): string | undefined {
    const rowUrl =
      row !== null && row.provider === 'custom'
        ? row.baseUrl?.trim()
        : undefined;
    return rowUrl !== undefined && rowUrl !== '' ? rowUrl : undefined;
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
