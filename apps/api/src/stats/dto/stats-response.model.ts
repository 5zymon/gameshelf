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

export class StatsResponseModel {
  @ApiProperty({ type: StatsTotalsModel })
  totals!: StatsTotalsModel;
}
