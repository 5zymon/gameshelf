import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { lowercaseId } from '../../common/lowercase-id';
import { UUID_V7_EXAMPLE } from '../../common/uuid-v7';

/**
 * Query params for `GET /import-jobs/:id/unrecognized/:itemId/search`.
 *
 * `q` is the corrected title; below 2 normalized characters the API returns
 * `[]` without calling the game database. `platformId` is a preference, not a
 * filter: candidates on it are listed first, in catalog order.
 */
export class SearchUnrecognizedItemQueryDto {
  @ApiPropertyOptional({
    description:
      'Corrected title. Below 2 normalized chars → [] without calling the game database.',
    example: 'hollow',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  q?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: UUID_V7_EXAMPLE,
    description: 'Preferred platform; matches on it are listed first.',
  })
  @IsOptional()
  @Transform(lowercaseId)
  @IsUUID('7')
  platformId?: string;
}
