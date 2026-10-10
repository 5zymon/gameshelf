import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Platform projection used in every game response (D4). */
export class GamePlatformModel {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'PlayStation 5' })
  name!: string;

  @ApiProperty({ example: 'ps5' })
  slug!: string;
}

/** Lighter list projection (D4). */
export class GameListItemModel {
  @ApiProperty({ example: 1 })
  id!: number;

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

  @ApiProperty({ type: GamePlatformModel })
  platform!: GamePlatformModel;
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
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'Hollow Knight' })
  title!: string;

  @ApiProperty({ example: 1 })
  platformId!: number;

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
