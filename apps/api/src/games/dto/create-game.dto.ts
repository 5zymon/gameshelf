import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { lowercaseId } from '../../common/lowercase-id';
import { UUID_V7_EXAMPLE } from '../../common/uuid-v7';
import { EnrichCandidateDto } from './enrich-game.dto';

export class CreateGameDto {
  @ApiProperty({
    description: 'Game title',
    example: 'Hollow Knight',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @ApiProperty({
    description: 'Existing platform id (UUIDv7)',
    format: 'uuid',
    example: UUID_V7_EXAMPLE,
  })
  @Transform(lowercaseId)
  @IsUUID('7')
  platformId!: string;

  @ApiPropertyOptional({
    description: 'Edition (free-form, D8)',
    example: 'GOTY Edition',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  edition?: string;

  @ApiPropertyOptional({ description: 'Release year', example: 2017 })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(2100)
  releaseYear?: number;

  @ApiPropertyOptional({
    description: 'Publisher',
    example: 'Team Cherry',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  publisher?: string;

  @ApiPropertyOptional({
    description: 'Genre',
    example: 'Metroidvania',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  genre?: string;

  @ApiPropertyOptional({
    description: 'Player count',
    example: 1,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  playerCount?: number;

  @ApiPropertyOptional({
    description: 'Description (IGDB summary or hand-written; not translated)',
    maxLength: 16000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(16000)
  summary?: string;

  @ApiPropertyOptional({
    description:
      'Cover image URL (no format check — local paths are a later ticket, S1.8)',
    example: 'https://example.com/hk.jpg',
    maxLength: 2083,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2083)
  coverUrl?: string;

  @ApiPropertyOptional({
    type: EnrichCandidateDto,
    description:
      'External catalog row the user picked from GET /games/search. When present the row is saved linked (source+externalId) and re-verified against a fresh search; the catalog cover wins over `coverUrl`.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => EnrichCandidateDto)
  candidate?: EnrichCandidateDto;
}
