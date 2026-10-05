import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/**
 * Route params for `PATCH /import-jobs/:id/unrecognized/:itemId`.
 *
 * One DTO carrying both params: the global pipe validates the whole
 * `req.params` object against a single metatype per `@Param()`, so two
 * separate param DTOs on the same route would each reject the other's
 * property (`forbidNonWhitelisted`).
 */
export class UnrecognizedItemIdParamDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id!: number;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  itemId!: number;
}
