import { ApiProperty } from '@nestjs/swagger';

/** Outcome counts of one reference-platform refresh. */
export class PlatformSyncResultModel {
  @ApiProperty({ example: 200 })
  fetched!: number;

  @ApiProperty({ example: 3 })
  created!: number;

  @ApiProperty({ example: 1 })
  updated!: number;

  @ApiProperty({ example: 196 })
  unchanged!: number;
}
