import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min, ValidateNested } from 'class-validator';

/** The external row a client picked from a previous search response. */
export class EnrichCandidateDto {
  @ApiProperty({ enum: ['IGDB', 'MobyGames'], example: 'IGDB' })
  @IsIn(['IGDB', 'MobyGames'])
  source!: 'IGDB' | 'MobyGames';

  @ApiProperty({ example: 1036 })
  @IsInt()
  @Min(1)
  externalId!: number;
}

/**
 * `POST /games/:id/enrich` body. Omitted (or `{}`) = search only; a
 * `candidate` = apply that pick.
 */
export class EnrichGameDto {
  @ApiPropertyOptional({ type: EnrichCandidateDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EnrichCandidateDto)
  candidate?: EnrichCandidateDto;
}
