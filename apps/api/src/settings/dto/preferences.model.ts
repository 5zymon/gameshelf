import { ApiProperty } from '@nestjs/swagger';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  type Language,
} from '../../i18n/language';

/**
 * The authenticated user's preferences. Currently only the UI language; the
 * shape is an object (not a bare string) so future preferences can be added
 * without a breaking wire change.
 */
export class PreferencesModel {
  @ApiProperty({
    enum: [...SUPPORTED_LANGUAGES],
    example: DEFAULT_LANGUAGE,
  })
  language!: Language;
}
