import { ApiProperty } from '@nestjs/swagger';
import {
  VISION_TEST_CODES,
  type VisionTestCode,
} from '../vision/vision.errors';
import {
  SUPPORTED_PROVIDER_IDS,
  type VisionProviderId,
} from '../vision/vision-provider';

/**
 * Result of a live provider test. The HTTP status is always 200 — a completed
 * but failed test is reported in the body via `ok: false` and a stable code.
 */
export class LlmTestResultModel {
  @ApiProperty({ example: true })
  ok!: boolean;

  @ApiProperty({ enum: [...VISION_TEST_CODES], example: 'ok' })
  code!: VisionTestCode;

  @ApiProperty({ enum: [...SUPPORTED_PROVIDER_IDS], example: 'gemini' })
  provider!: VisionProviderId;

  @ApiProperty({ example: 'gemini-3.8-flash' })
  model!: string;

  @ApiProperty({
    example: 'The provider accepted the request',
    description:
      'Human-readable, safe summary (never the key or upstream body)',
  })
  message!: string;
}
