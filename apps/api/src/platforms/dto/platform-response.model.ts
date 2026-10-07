import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Full platform record with the number of games on it. */
export class PlatformModel {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'PlayStation 5' })
  name!: string;

  @ApiPropertyOptional({ nullable: true, example: 'PS5' })
  abbreviation!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'PS5' })
  alternativeName!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'IGDB platform family reference id',
    example: 1,
  })
  platformFamily!: number | null;

  @ApiPropertyOptional({ nullable: true, example: 130 })
  igdbId!: number | null;

  @ApiProperty({ example: 'playstation-5' })
  slug!: string;

  @ApiProperty({
    description: 'Created by the import and awaiting review',
    example: false,
  })
  addedByImport!: boolean;

  @ApiProperty({
    description: 'Hidden reference platform (DELETE sets this)',
    example: false,
  })
  hidden!: boolean;

  @ApiProperty({
    description: 'Number of games on this platform',
    example: 12,
  })
  gameCount!: number;
}
