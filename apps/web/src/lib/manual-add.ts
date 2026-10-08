import type { TranslatorFor } from '@/i18n/translate';
import type { CreateGameRequest } from '@/lib/api';

export interface ManualAddDraft {
  title: string;
  platformId: string;
  edition: string;
  releaseYear: string;
  publisher: string;
  genre: string;
  playerCount: string;
}

export type ManualAddField = keyof ManualAddDraft;
export type ManualAddFieldErrors = Partial<Record<ManualAddField, string>>;

export const MANUAL_ADD_FIELDS = [
  'title',
  'platformId',
  'edition',
  'releaseYear',
  'publisher',
  'genre',
  'playerCount',
] as const satisfies readonly ManualAddField[];

/** All-empty draft; `platformId` is preserved by callers after a save. */
export function emptyManualAddDraft(platformId = ''): ManualAddDraft {
  return {
    title: '',
    platformId,
    edition: '',
    releaseYear: '',
    publisher: '',
    genre: '',
    playerCount: '',
  };
}

/** '' → undefined, valid int in [min,max] → number, else 'invalid'. (Copied from game-edit-form.) */
export function boundedInt(
  raw: string,
  min: number,
  max: number,
): number | undefined | 'invalid' {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  if (!/^\d+$/.test(trimmed)) return 'invalid';
  const value = Number(trimmed);
  return value >= min && value <= max ? value : 'invalid';
}

const MAX_TEXT = 255;

export interface ManualAddBuildResult {
  request: CreateGameRequest | null;
  errors: ManualAddFieldErrors;
}

/** Client-side mirror of CreateGameDto. `request` is null when `errors` is non-empty. */
export function buildCreateRequest(
  draft: ManualAddDraft,
  t: TranslatorFor<'manualAdd'>,
): ManualAddBuildResult {
  const errors: ManualAddFieldErrors = {};

  const title = draft.title.trim();
  if (title === '') errors.title = t('error.titleRequired');
  else if (title.length > MAX_TEXT) errors.title = t('error.titleMax');

  const platformId = Number(draft.platformId);
  if (
    draft.platformId.trim() === '' ||
    !Number.isInteger(platformId) ||
    platformId < 1
  ) {
    errors.platformId = t('error.choosePlatform');
  }

  const edition = draft.edition.trim();
  if (edition.length > MAX_TEXT) errors.edition = t('error.editionMax');

  const releaseYear = boundedInt(draft.releaseYear, 1000, 2100);
  if (releaseYear === 'invalid') errors.releaseYear = t('error.yearRange');

  const playerCount = boundedInt(draft.playerCount, 1, 100);
  if (playerCount === 'invalid') errors.playerCount = t('error.playersRange');

  const publisher = draft.publisher.trim();
  if (publisher.length > MAX_TEXT) errors.publisher = t('error.publisherMax');

  const genre = draft.genre.trim();
  if (genre.length > MAX_TEXT) errors.genre = t('error.genreMax');

  if (Object.keys(errors).length > 0) return { request: null, errors };

  return {
    request: {
      title,
      platformId,
      ...(edition !== '' && { edition }),
      ...(typeof releaseYear === 'number' && { releaseYear }),
      ...(typeof playerCount === 'number' && { playerCount }),
      ...(publisher !== '' && { publisher }),
      ...(genre !== '' && { genre }),
    },
    errors: {},
  };
}

function isManualAddField(value: string): value is ManualAddField {
  return (MANUAL_ADD_FIELDS as readonly string[]).includes(value);
}

export interface MappedServerErrors {
  fieldErrors: ManualAddFieldErrors;
  formError: string | null;
}

/**
 * Maps Nest 400 bodies to fields. class-validator default messages start with
 * the property name ("title should not be empty", "releaseYear must not be
 * less than 1000"); the unknown-platform error is a bare string. Anything else
 * (e.g. `forbidNonWhitelisted`'s "property … should not exist") is form-level.
 */
export function mapServerErrors(
  messages: readonly string[],
): MappedServerErrors {
  const fieldErrors: ManualAddFieldErrors = {};
  const formMessages: string[] = [];
  for (const message of messages) {
    const key = /^([A-Za-z]+)\b/.exec(message.trim())?.[1];
    if (key !== undefined && isManualAddField(key)) fieldErrors[key] = message;
    else if (message.startsWith('Platform with id'))
      fieldErrors.platformId = message;
    else formMessages.push(message);
  }
  return {
    fieldErrors,
    formError: formMessages.length > 0 ? formMessages.join(' ') : null,
  };
}
