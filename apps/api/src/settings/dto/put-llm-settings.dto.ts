import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  SUPPORTED_PROVIDER_IDS,
  type VisionProviderId,
} from '../vision/vision-provider';

export const LLM_MODEL_MAX_LENGTH = 128;
export const LLM_API_KEY_MAX_LENGTH = 512;

/**
 * Body of `PUT /settings/llm`. `apiKey` is write-only: omitted keeps the
 * stored key when `provider` is unchanged (otherwise the stored key is
 * cleared), `""` clears it, any other value replaces it. It is never
 * echoed back by any endpoint.
 */
export class PutLlmSettingsDto {
  @ApiProperty({ enum: [...SUPPORTED_PROVIDER_IDS], example: 'gemini' })
  @IsIn([...SUPPORTED_PROVIDER_IDS])
  provider!: VisionProviderId;

  @ApiPropertyOptional({
    maxLength: LLM_MODEL_MAX_LENGTH,
    example: 'gemini-3.8-flash',
    description:
      'Omit to keep when the provider is unchanged; reset to the provider ' +
      'default when the provider changes. Empty clears the override.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LLM_MODEL_MAX_LENGTH)
  model?: string;

  @ApiPropertyOptional({
    writeOnly: true,
    maxLength: LLM_API_KEY_MAX_LENGTH,
    example: 'AIza...',
    description:
      'Write-only. Omit to keep when the provider is unchanged; cleared when ' +
      'the provider changes. Send "" to clear it. Never returned.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LLM_API_KEY_MAX_LENGTH)
  apiKey?: string;
}
