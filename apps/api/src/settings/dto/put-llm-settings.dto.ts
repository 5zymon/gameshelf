import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  SUPPORTED_PROVIDER_IDS,
  type VisionProviderId,
} from '../vision/vision-provider';

export const LLM_MODEL_MAX_LENGTH = 128;
export const LLM_BASE_URL_MAX_LENGTH = 512;
export const LLM_API_KEY_MAX_LENGTH = 512;

/**
 * Body of `PUT /settings/llm`. `apiKey` is write-only: omitted keeps the
 * stored key (a key stored by a removed provider is never reused), `""`
 * clears it, any other value replaces it. It is never echoed back by any
 * endpoint.
 */
export class PutLlmSettingsDto {
  @ApiProperty({ enum: [...SUPPORTED_PROVIDER_IDS], example: 'custom' })
  @IsIn([...SUPPORTED_PROVIDER_IDS])
  provider!: VisionProviderId;

  @ApiPropertyOptional({
    maxLength: LLM_MODEL_MAX_LENGTH,
    example: 'llava:7b',
    description: 'Omit to keep the stored model. Empty clears the override.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LLM_MODEL_MAX_LENGTH)
  model?: string;

  @ApiPropertyOptional({
    maxLength: LLM_BASE_URL_MAX_LENGTH,
    example: 'http://localhost:11434/v1',
    description:
      'Absolute http(s) URL of the OpenAI-compatible endpoint (trailing / ' +
      'normalized). Required unless a base URL is already stored; omit to ' +
      'keep it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LLM_BASE_URL_MAX_LENGTH)
  baseUrl?: string;

  @ApiPropertyOptional({
    writeOnly: true,
    maxLength: LLM_API_KEY_MAX_LENGTH,
    example: 'sk-...',
    description:
      'Write-only. Omit to keep the stored key. Send "" to clear it. ' +
      'Never returned.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LLM_API_KEY_MAX_LENGTH)
  apiKey?: string;
}
