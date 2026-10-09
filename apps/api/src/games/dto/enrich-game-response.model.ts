import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  CatalogCandidate,
  CatalogSource,
} from '../../game-catalog/game-catalog.resolver';
import { GameDetailModel } from './game-response.model';

/** One external platform a candidate is known to run on. */
export class EnrichCandidatePlatformModel {
  @ApiPropertyOptional({ nullable: true, example: 11 })
  igdbId!: number | null;

  @ApiProperty({ example: 'Xbox' })
  name!: string;

  @ApiPropertyOptional({ nullable: true, example: 'XBOX' })
  abbreviation!: string | null;
}

/** A candidate returned by the search, minus the archival raw payload. */
export class EnrichCandidateModel {
  @ApiProperty({ example: 1036 })
  externalId!: number;

  @ApiProperty({ example: 'Halo: Combat Evolved' })
  title!: string;

  @ApiPropertyOptional({ nullable: true, example: 2001 })
  releaseYear!: number | null;

  @ApiPropertyOptional({ nullable: true, example: 'Bungie' })
  publisher!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Shooter' })
  genre!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 16 })
  playerCount!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Same-origin signed preview URL (server-side passthrough); never an external host',
    example: '/api/covers/preview?u=aHR0cHM6Ly9pbWFnZXMuaWdkYi5jb20v...&s=...',
  })
  coverUrl!: string | null;

  @ApiProperty({ type: [EnrichCandidatePlatformModel] })
  platforms!: EnrichCandidatePlatformModel[];

  @ApiProperty({ enum: ['IGDB', 'MobyGames'], example: 'IGDB' })
  source!: CatalogSource;
}

/**
 * Drops the archival `raw` payload — never exposed in a response body — and
 * replaces the candidate's external `coverUrl` with a same-origin signed preview
 * URL (the external host never reaches the browser).
 */
export function toEnrichCandidateModel(
  candidate: CatalogCandidate,
  coverUrl: string | null,
): EnrichCandidateModel {
  const { raw: _raw, images: _images, ...rest } = candidate;
  return { ...rest, coverUrl };
}

/**
 * `POST /games/:id/enrich` response. `status` is one of `matched`,
 * `unrecognized`, `transient`, `config_error`; `applied` is true only when the
 * apply step wrote a change. `transient`/`config_error` are surfaced as HTTP
 * 503 by the service and never carry this body.
 */
export class EnrichGameResponseModel {
  @ApiProperty({
    enum: ['matched', 'unrecognized', 'transient', 'config_error'],
    example: 'matched',
  })
  status!: 'matched' | 'unrecognized' | 'transient' | 'config_error';

  @ApiPropertyOptional({ nullable: true, example: null })
  reason!: string | null;

  @ApiProperty({ example: false })
  applied!: boolean;

  @ApiProperty({
    type: [EnrichCandidateModel],
    description:
      'Ranked candidates, best first, up to CATALOG_SEARCH_MAX_RESULTS (10); empty when nothing matched. On apply, only the picked candidate is written.',
  })
  candidates!: EnrichCandidateModel[];

  @ApiProperty({ type: GameDetailModel })
  game!: GameDetailModel;
}
