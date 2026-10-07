import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SearchGamesQueryDto {
  @ApiPropertyOptional({
    description:
      'Partial title. Below 2 normalized chars the API returns [] without calling the game database.',
    example: 'hollow',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  q?: string;
}
