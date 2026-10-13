import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';

import { lowercaseId } from '../../common/lowercase-id';
import { UUID_V7_EXAMPLE } from '../../common/uuid-v7';
import { CATALOG_SEARCH_MIN_QUERY_LENGTH } from '../../game-catalog/catalog-search.options';
import { normalizeTitle } from '../../game-catalog/title-match';
import type { CatalogSource } from '../../game-catalog/game-catalog.resolver';

/** Trims before validation so a whitespace-only query cannot pass. */
function trimQuery({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * Rejects a string whose `normalizeTitle` form is shorter than `min` — the
 * same bar `CatalogSearchService` applies before an upstream call. Without it,
 * a whitespace-only/too-short `query` would search for nothing, come back
 * empty and surface a misleading 409 instead of a 400.
 */
function MinNormalizedLength(
  min: number,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'minNormalizedLength',
      target: target.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value !== 'string' || normalizeTitle(value).length >= min
          );
        },
      },
    });
  };
}

/**
 * The catalog candidate a client picked for a flagged item (card 105): one of
 * the item's stored tied candidates, or a candidate from a re-search. It is
 * re-confirmed against a fresh catalog search before a game is created. With
 * `query` the stored-tie requirement is lifted and the fresh search runs for
 * that corrected title instead of the stored candidate's title.
 */
export class PickUnrecognizedCandidateDto {
  @ApiProperty({ enum: ['IGDB', 'MobyGames'], example: 'IGDB' })
  @IsIn(['IGDB', 'MobyGames'])
  source!: CatalogSource;

  @ApiProperty({ example: 18797 })
  @IsInt()
  @Min(1)
  externalId!: number;

  @ApiPropertyOptional({
    maxLength: 255,
    description:
      'The re-search query that produced this candidate. When set, the candidate need not be a stored tied candidate; it is re-confirmed against a fresh search for this query. Trimmed; at least 2 letters or digits after normalization.',
  })
  @IsOptional()
  @IsString()
  @Transform(trimQuery)
  @MinNormalizedLength(CATALOG_SEARCH_MIN_QUERY_LENGTH, {
    message: 'query must contain at least 2 letters or digits',
  })
  @MaxLength(255)
  query?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: UUID_V7_EXAMPLE,
    description: 'User-confirmed platform; overrides photo/catalog resolution.',
  })
  @IsOptional()
  @Transform(lowercaseId)
  @IsUUID('7')
  platformId?: string;
}
