import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SUPPORTED_PROVIDER_IDS,
  type VisionProviderId,
} from '../vision/vision-provider';

/** One selectable backend, so the settings UI can list providers + defaults. */
export class LlmProviderSummaryModel {
  @ApiProperty({ enum: [...SUPPORTED_PROVIDER_IDS], example: 'custom' })
  id!: VisionProviderId;

  @ApiProperty({ example: 'Custom (OpenAI-compatible)' })
  label!: string;

  @ApiProperty({ example: '' })
  defaultModel!: string;
}

/**
 * Public LLM settings projection. It never contains the API key (or its
 * ciphertext) — only whether one is present.
 */
export class LlmSettingsModel {
  @ApiProperty({ enum: [...SUPPORTED_PROVIDER_IDS], example: 'custom' })
  provider!: VisionProviderId;

  @ApiProperty({ example: 'llava:7b' })
  model!: string;

  @ApiProperty({
    nullable: true,
    example: 'http://localhost:11434/v1',
    description:
      "The OpenAI-compatible endpoint's base URL; null until one is saved. " +
      'Not a secret — shown in the UI.',
  })
  baseUrl!: string | null;

  @ApiProperty({
    example: true,
    description: 'True when an API key is available (encrypted DB row or env)',
  })
  keyPresent!: boolean;

  @ApiProperty({
    example: true,
    description:
      'True when both an API key and a base URL are available: ' +
      'recognition/upload can run.',
  })
  importEnabled!: boolean;

  @ApiProperty({ type: [LlmProviderSummaryModel] })
  availableProviders!: LlmProviderSummaryModel[];

  @ApiPropertyOptional({
    nullable: true,
    format: 'date-time',
    description:
      'When the stored settings row was last changed (null if unset)',
  })
  updatedAt!: Date | null;
}
