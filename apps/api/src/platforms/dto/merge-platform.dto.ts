import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

/** Body of `POST /platforms/:id/merge`. */
export class MergePlatformDto {
  @ApiProperty({ description: 'Surviving target platform id', example: 1 })
  @IsInt()
  @Min(1)
  targetId!: number;
}
