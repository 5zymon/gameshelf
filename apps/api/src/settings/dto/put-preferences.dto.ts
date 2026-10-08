import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { SUPPORTED_LANGUAGES, type Language } from '../../i18n/language';
import { SUPPORTED_THEMES, type Theme } from '../theme';

/** Body of `PUT /settings/preferences`: the new UI language and theme. */
export class PutPreferencesDto {
  @ApiProperty({ enum: [...SUPPORTED_LANGUAGES], example: 'en' })
  @IsIn([...SUPPORTED_LANGUAGES])
  language!: Language;

  @ApiProperty({ enum: [...SUPPORTED_THEMES], example: 'system' })
  @IsIn([...SUPPORTED_THEMES])
  theme!: Theme;
}
