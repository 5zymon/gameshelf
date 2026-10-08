import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { SUPPORTED_LANGUAGES, type Language } from '../../i18n/language';

/** Body of `PUT /settings/preferences`: the new UI language. */
export class PutPreferencesDto {
  @ApiProperty({ enum: [...SUPPORTED_LANGUAGES], example: 'en' })
  @IsIn([...SUPPORTED_LANGUAGES])
  language!: Language;
}
