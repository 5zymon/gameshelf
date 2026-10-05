import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/**
 * One-way dismissal (assumption A6): `dismissed: true` stamps `dismissed_at`;
 * there is no un-dismiss. The controller rejects `dismissed: false` with a
 * 400 because the API has no "re-open" operation.
 */
export class DismissUnrecognizedItemDto {
  @ApiProperty({ default: true })
  @IsBoolean()
  dismissed!: boolean;
}
