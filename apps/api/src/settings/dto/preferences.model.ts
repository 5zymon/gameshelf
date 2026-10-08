import { ApiProperty } from '@nestjs/swagger';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  type Language,
} from '../../i18n/language';
import { DEFAULT_THEME, SUPPORTED_THEMES, type Theme } from '../theme';

/**
 * The authenticated user's preferences: the UI language and the UI theme. The
 * shape is an object (not a bare string) so future preferences can be added
 * without a breaking wire change.
 */
export class PreferencesModel {
  @ApiProperty({
    enum: [...SUPPORTED_LANGUAGES],
    example: DEFAULT_LANGUAGE,
  })
  language!: Language;

  @ApiProperty({ enum: [...SUPPORTED_THEMES], example: DEFAULT_THEME })
  theme!: Theme;
}
