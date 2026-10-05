import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateGameDto {
  @ApiProperty({
    description: 'Game title',
    example: 'Hollow Knight',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @ApiProperty({
    description: 'Existing platform id (FK platforms.id)',
    example: 1,
  })
  @IsInt()
  @Min(1)
  platformId!: number;

  @ApiPropertyOptional({
    description: 'Edition (free-form, D8)',
    example: 'GOTY Edition',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  edition?: string;

  @ApiPropertyOptional({ description: 'Release year', example: 2017 })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(2100)
  releaseYear?: number;

  @ApiPropertyOptional({
    description: 'Publisher',
    example: 'Team Cherry',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  publisher?: string;

  @ApiPropertyOptional({
    description: 'Genre',
    example: 'Metroidvania',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  genre?: string;

  @ApiPropertyOptional({
    description: 'Player count',
    example: 1,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  playerCount?: number;

  @ApiPropertyOptional({
    description:
      'Cover image URL (no format check — local paths are a later ticket, S1.8)',
    example: 'https://example.com/hk.jpg',
    maxLength: 2083,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2083)
  coverUrl?: string;
}
