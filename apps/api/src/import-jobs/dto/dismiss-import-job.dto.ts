import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

/**
 * The only user-settable status. The pipeline owns every other value; the
 * user's single action on a job is dismissing it (spec §4.2.4).
 */
export class DismissImportJobDto {
  @ApiProperty({ enum: ['dismissed'], default: 'dismissed' })
  @IsIn(['dismissed'])
  status!: 'dismissed';
}
