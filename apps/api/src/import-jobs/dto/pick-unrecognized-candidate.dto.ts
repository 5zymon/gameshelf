import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, Min } from 'class-validator';
import type { CatalogSource } from '../../game-catalog/game-catalog.resolver';

/**
 * The tied candidate a client picked for a flagged item (card 105). The pair
 * must match one of the item's stored `candidates`; it is re-confirmed against
 * a fresh catalog search before a game is created.
 */
export class PickUnrecognizedCandidateDto {
  @ApiProperty({ enum: ['IGDB', 'MobyGames'], example: 'IGDB' })
  @IsIn(['IGDB', 'MobyGames'])
  source!: CatalogSource;

  @ApiProperty({ example: 18797 })
  @IsInt()
  @Min(1)
  externalId!: number;
}
