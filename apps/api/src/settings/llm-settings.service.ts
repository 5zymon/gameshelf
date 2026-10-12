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
  DEFAULT_PROVIDER_ID,
  VISION_API_KEY_ENV_VAR,
  type VisionProviderId,
} from './vision/vision-provider';

const SINGLETON_ID = 1;

export interface ActiveLlmConfig {
  provider: VisionProviderId;
  model: string;
  apiKey: string;
  baseUrl: string;
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
 * Key precedence:
 *   1. the encrypted `api_key_ciphertext` on the row (only when the row's
 *      provider is the active provider), then
 *   2. `CUSTOM_API_KEY`, then
 *   3. none.
 * Recognition also needs a base URL (stored on a `custom` row only; no env
 * fallback). Without a key AND a base URL, recognition is disabled.
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
    const keyPresent = this.resolveApiKey(provider, row) !== null;
    const baseUrl = this.resolveBaseUrl(provider, row) ?? null;
    return {
      provider,
      model: this.resolveModel(provider, row),
      baseUrl,
      keyPresent,
      importEnabled: keyPresent && baseUrl !== null,
      availableProviders: this.availableProviders(),
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /**
   * Effective config, or `null` when no key or no base URL is available for
   * the provider.
   */
  async resolveActive(): Promise<ActiveLlmConfig | null> {
    const row = await this.readRow();
    const provider = this.resolveProviderId(row);
    const apiKey = this.resolveApiKey(provider, row);
    const baseUrl = this.resolveBaseUrl(provider, row);
    if (apiKey === null || baseUrl === undefined) return null;
    return {
      provider,
      model: this.resolveModel(provider, row),
      apiKey,
      baseUrl,
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

    // The base URL is required: send one, or keep the URL already stored on a
    // `custom` row. A legacy row from a removed provider has none to keep.
    let baseUrl: string | undefined;
    if (dto.baseUrl !== undefined) {
      const trimmed = dto.baseUrl.trim();
      if (trimmed === '') {
        throw new BadRequestException('Base URL is required');
      }
      const normalized = normalizeBaseUrl(trimmed);
      if (normalized === null) {
        throw new BadRequestException(
          'Base URL must be an absolute http:// or https:// URL',
        );
      }
      baseUrl = normalized;
    } else if (
      switchesProvider ||
      this.readStoredBaseUrl(existing) === undefined
    ) {
      throw new BadRequestException('Base URL is required');
    } // else: undefined → keep the column as-is

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

  /** The row's provider when registered, else `custom` (legacy gemini/openai rows land here). */
  private resolveProviderId(row: LlmSetting | null): VisionProviderId {
    return row !== null && this.registry.has(row.provider)
      ? row.provider
      : DEFAULT_PROVIDER_ID;
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

  /** The stored base URL when the row belongs to the active provider, trimmed; else `undefined`. */
  private resolveBaseUrl(
    provider: VisionProviderId,
    row: LlmSetting | null,
  ): string | undefined {
    const rowUrl =
      row !== null && row.provider === provider
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
    const envKey = this.config.get<string>(VISION_API_KEY_ENV_VAR);
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
