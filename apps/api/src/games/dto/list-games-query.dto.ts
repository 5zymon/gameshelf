import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export type GameSortField = 'title' | 'year' | 'platform' | 'createdAt';
export type SortDirection = 'asc' | 'desc';

const SORT_FIELDS: readonly GameSortField[] = [
  'title',
  'year',
  'platform',
  'createdAt',
];
const SORT_DIRECTIONS: readonly SortDirection[] = ['asc', 'desc'];

export class ListGamesQueryDto {
  @ApiPropertyOptional({
    description: 'Page number (1-based)',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Page size (default 20, max 100)',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Filter by platform id (FK platforms.id). Unknown id returns an empty result.',
    example: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  platformId?: number;

  @ApiPropertyOptional({
    description: 'Exact edition match (whitespace-trimmed)',
    example: 'GOTY Edition',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  edition?: string;

  @ApiPropertyOptional({
    description: 'Exact release year match',
    example: 2017,
    minimum: 1000,
    maximum: 2100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({
    description: 'Exact publisher match (whitespace-trimmed)',
    example: 'Team Cherry',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  publisher?: string;

  @ApiPropertyOptional({
    description: 'Exact genre match (whitespace-trimmed)',
    example: 'Metroidvania',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  genre?: string;

  @ApiPropertyOptional({
    description: 'Exact player count match',
    example: 1,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  playerCount?: number;

  @ApiPropertyOptional({
    description:
      'Case-insensitive partial title search (LIKE; `%`, `_`, `\\` are escaped)',
    example: 'hollow',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  q?: string;

  @ApiPropertyOptional({
    description:
      'Sort field. Deterministic: `id` is always the tiebreaker. `year` puts unknown years last.',
    enum: SORT_FIELDS,
    example: 'title',
  })
  @IsOptional()
  @IsIn([...SORT_FIELDS])
  sort?: GameSortField;

  @ApiPropertyOptional({
    description:
      'Sort direction; only applies when `sort` is set (default asc)',
    enum: SORT_DIRECTIONS,
    default: 'asc',
  })
  @IsOptional()
  @IsIn([...SORT_DIRECTIONS])
  order?: SortDirection;
}
