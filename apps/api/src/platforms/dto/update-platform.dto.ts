import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Rename + canonical-field update. `name` is required (rename is the primary
 * operation). The canonical fields are written by the IGDB integration
 * (ticket 4.2 — "canonical mapping needs a place to write its results");
 * an explicit `null` clears one (`@IsOptional` lets `null` through, same
 * semantics as `UpdateGameDto`).
 */
export class UpdatePlatformDto {
  @ApiProperty({
    description: 'New platform name (unique, case-insensitive)',
    example: 'PlayStation 5',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Canonical abbreviation (e.g. PS5)',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  abbreviation?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Alternative name (e.g. PS5)',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  alternativeName?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'IGDB platform id',
    example: 130,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  igdbId?: number | null;
}
