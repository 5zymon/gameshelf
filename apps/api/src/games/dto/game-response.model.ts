import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { UUID_V7_EXAMPLE } from '../../common/uuid-v7';

/** Platform projection used in every game response (D4). */
export class GamePlatformModel {
  @ApiProperty({ format: 'uuid', example: UUID_V7_EXAMPLE })
  id!: string;

  @ApiProperty({ example: 'PlayStation 5' })
  name!: string;

  @ApiProperty({ example: 'ps5' })
  slug!: string;
}

/** Lighter list projection (D4). */
export class GameListItemModel {
  @ApiProperty({ format: 'uuid', example: UUID_V7_EXAMPLE })
  id!: string;

  @ApiProperty({ example: 'Hollow Knight' })
  title!: string;

  @ApiPropertyOptional({ nullable: true, example: 'GOTY Edition' })
  edition!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: '/api/covers/0123456789abcdef0123456789abcdef.jpg',
  })
  coverUrl!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Locally generated thumbnail (same origin)',
    example: '/api/covers/thumbs/0123456789abcdef0123456789abcdef.jpg',
  })
  coverThumbUrl!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'IGDB rating 0–100; null when unrated (never 0 as a placeholder)',
    example: 78.4,
  })
  rating!: number | null;

  @ApiProperty({ type: GamePlatformModel })
  platform!: GamePlatformModel;
}

/** One embedded YouTube video (card 9.1). */
export class GameVideoModel {
  @ApiProperty({ format: 'uuid', example: UUID_V7_EXAMPLE })
  id!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Trailer' })
  name!: string | null;

  @ApiProperty({
    example: 'dQw4w9WgXcQ',
    description:
      'YouTube video id; embedded as https://www.youtube.com/embed/<videoId>',
  })
  videoId!: string;
}

/** One locally cached gallery image, served same-origin. */
export class GameImageModel {
  @ApiProperty({ example: '/api/covers/0123456789abcdef0123456789abcdef.jpg' })
  url!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Locally generated thumbnail (same origin, WebP)',
    example: '/api/covers/thumbs/0123456789abcdef0123456789abcdef.jpg',
  })
  thumbUrl!: string | null;
}

/** Full record (D4): all Game fields incl. rawMetadata + platform. */
export class GameDetailModel {
  @ApiProperty({ format: 'uuid', example: UUID_V7_EXAMPLE })
  id!: string;

  @ApiProperty({ example: 'Hollow Knight' })
  title!: string;

  @ApiProperty({ format: 'uuid', example: UUID_V7_EXAMPLE })
  platformId!: string;

  @ApiPropertyOptional({ nullable: true, example: 'GOTY Edition' })
  edition!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 2017 })
  releaseYear!: number | null;

  @ApiPropertyOptional({ nullable: true, example: 'Team Cherry' })
  publisher!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Metroidvania' })
  genre!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 1 })
  playerCount!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Description (IGDB summary or hand-written; not translated)',
    example: 'A first-person shooter set in the Halo universe.',
  })
  summary!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'IGDB rating 0–100; null when unrated',
    example: 78.4,
  })
  rating!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'IGDB user-rating vote count',
    example: 512,
  })
  ratingCount!: number | null;

  @ApiProperty({
    example: 1,
    description: 'Physical copies owned (identity is one row)',
  })
  copyCount!: number;

  @ApiPropertyOptional({
    nullable: true,
    example: '/api/covers/0123456789abcdef0123456789abcdef.jpg',
  })
  coverUrl!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Locally generated thumbnail (same origin, WebP). Null when no cover.',
    example: '/api/covers/thumbs/0123456789abcdef0123456789abcdef.jpg',
  })
  coverThumbUrl!: string | null;

  @ApiProperty({ type: [GameImageModel] })
  images!: GameImageModel[];

  @ApiProperty({ type: [GameVideoModel] })
  videos!: GameVideoModel[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'Raw IGDB/MobyGames payload (archival)',
  })
  rawMetadata!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  enrichedAt!: Date | null;

  @ApiProperty({ enum: ['IGDB', 'MobyGames', 'MANUAL'], example: 'MANUAL' })
  source!: string;

  @ApiPropertyOptional({ nullable: true, example: 1036 })
  externalId!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Canonical IGDB page (https://www.igdb.com/games/<slug>). Null unless the game came from IGDB with a stored slug.',
    example: 'https://www.igdb.com/games/halo-combat-evolved',
  })
  igdbUrl!: string | null;

  @ApiProperty({ example: false })
  platformUnverified!: boolean;

  @ApiProperty({ type: [String], example: ['publisher'] })
  userEditedFields!: string[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: GamePlatformModel })
  platform!: GamePlatformModel;
}

export class ListGamesMetaModel {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 42 })
  total!: number;

  @ApiProperty({ example: 3 })
  totalPages!: number;
}

export class ListGamesFiltersModel {
  @ApiProperty({
    type: [GamePlatformModel],
    description: 'Platforms that have at least one game (sorted by name)',
  })
  platforms!: GamePlatformModel[];

  @ApiProperty({
    type: [String],
    description: 'Distinct non-null edition values (sorted)',
    example: ['GOTY Edition'],
  })
  editions!: string[];
}

export class ListGamesResponseModel {
  @ApiProperty({ type: [GameListItemModel] })
  items!: GameListItemModel[];

  @ApiProperty({ type: ListGamesMetaModel })
  meta!: ListGamesMetaModel;

  @ApiProperty({
    type: ListGamesFiltersModel,
    description:
      'Available filter values for the filter bar (global, not scoped to the current filter combination)',
  })
  filters!: ListGamesFiltersModel;
}
