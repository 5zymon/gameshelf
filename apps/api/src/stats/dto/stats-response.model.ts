import { ApiProperty } from '@nestjs/swagger';

export class StatsTotalsModel {
  @ApiProperty({ description: 'Number of games (titles)', example: 128 })
  games!: number;

  @ApiProperty({
    description: 'Total physical copies (sum of copyCount)',
    example: 143,
  })
  copies!: number;
}

export class StatsPlatformModel {
  @ApiProperty({ description: 'Platform id' })
  id!: string;

  @ApiProperty({ description: 'Platform name', example: 'Nintendo Switch' })
  name!: string;

  @ApiProperty({
    description:
      'Games assigned to this platform, platformUnverified games included',
    example: 42,
  })
  games!: number;
}

export class StatsDataQualityModel {
  @ApiProperty({
    description: 'Games with platformUnverified = true',
    example: 3,
  })
  unverifiedPlatform!: number;
}

export class StatsDecadeModel {
  @ApiProperty({
    description: 'First year of the decade, e.g. 1990 for 1990-1999',
    example: 1990,
  })
  decade!: number;

  @ApiProperty({
    description: 'Games whose releaseYear falls in the decade',
    example: 17,
  })
  games!: number;
}

export class StatsResponseModel {
  @ApiProperty({ type: StatsTotalsModel })
  totals!: StatsTotalsModel;

  @ApiProperty({
    type: [StatsPlatformModel],
    description:
      'Only platforms with at least one game; games descending, then name ascending',
  })
  platforms!: StatsPlatformModel[];

  @ApiProperty({ type: StatsDataQualityModel })
  dataQuality!: StatsDataQualityModel;

  @ApiProperty({
    type: [StatsDecadeModel],
    description: 'Only decades with at least one game; decade ascending',
  })
  decades!: StatsDecadeModel[];

  @ApiProperty({
    description: 'Games with releaseYear = null',
    example: 4,
  })
  noReleaseYear!: number;
}
