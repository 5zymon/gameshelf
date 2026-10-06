import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SUPPORTED_PROVIDER_IDS,
  type VisionProviderId,
} from '../vision/vision-provider';

/** One selectable backend, so the settings UI can list providers + defaults. */
export class LlmProviderSummaryModel {
  @ApiProperty({ enum: [...SUPPORTED_PROVIDER_IDS], example: 'gemini' })
  id!: VisionProviderId;

  @ApiProperty({ example: 'Google Gemini' })
  label!: string;

  @ApiProperty({ example: 'gemini-3.8-flash' })
  defaultModel!: string;
}

/**
 * Public LLM settings projection. It never contains the API key (or its
 * ciphertext) — only whether one is present.
 */
export class LlmSettingsModel {
  @ApiProperty({ enum: [...SUPPORTED_PROVIDER_IDS], example: 'gemini' })
  provider!: VisionProviderId;

  @ApiProperty({ example: 'gemini-3.8-flash' })
  model!: string;

  @ApiProperty({
    example: true,
    description: 'True when an API key is available (encrypted DB row or env)',
  })
  keyPresent!: boolean;

  @ApiProperty({
    example: true,
    description: 'Alias of keyPresent: recognition/upload can run',
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
