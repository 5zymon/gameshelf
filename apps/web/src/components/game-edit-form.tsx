'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranslatorFor } from '@/i18n/translate';
import {
  isApiError,
  type GameDetail,
  type GamePlatform,
  type UpdateGameRequest,
} from '@/lib/api';
import { api } from '@/lib/api/browser';
import { isUuidV7 } from '@/lib/uuid';

const FIELD =
  'w-full h-10 rounded-control border border-edge bg-field px-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent/55 focus:ring-[3px] focus:ring-accent/15 disabled:opacity-60';
// `FIELD` has a fixed `h-10`, so the multiline summary field needs its own
// class (a growing textarea, not a fixed-height input).
const TEXTAREA =
  'w-full min-h-32 rounded-control border border-edge bg-field px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-muted outline-none focus:border-accent/55 focus:ring-[3px] focus:ring-accent/15 disabled:opacity-60';
const LABEL = 'block text-sm text-muted';

interface Draft {
  title: string;
  platformId: string;
  edition: string;
  releaseYear: string;
  publisher: string;
  genre: string;
  playerCount: string;
  summary: string;
}

type FieldErrors = Partial<
  Record<'title' | 'releaseYear' | 'playerCount', string>
>;

function toDraft(game: GameDetail): Draft {
  return {
    title: game.title,
    platformId: game.platformId,
    edition: game.edition ?? '',
    releaseYear: game.releaseYear === null ? '' : String(game.releaseYear),
    publisher: game.publisher ?? '',
    genre: game.genre ?? '',
    playerCount: game.playerCount === null ? '' : String(game.playerCount),
    summary: game.summary ?? '',
  };
}

/**
 * Preserve fields the user has edited but not saved when an external refresh
 * (e.g. re-enrich Apply) replaces `game`. A draft field is dirty when it
 * differs from the last synced game; dirty fields win over the incoming value.
 */
function mergeDraft(
  previous: GameDetail,
  current: Draft,
  incoming: Draft,
): Draft {
  const previousDraft = toDraft(previous);
  const merged = { ...incoming };
  for (const key of Object.keys(incoming) as (keyof Draft)[]) {
    if (current[key] !== previousDraft[key]) merged[key] = current[key];
  }
  return merged;
}

/** '' → undefined (no change), valid → number, invalid → 'invalid'. Mirrors catalog-filter-bar. */
function boundedInt(
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

/** Trimmed text edit: unchanged → omit; cleared → null; else set. */
function textDelta(
  value: string,
  current: string | null,
): string | null | undefined {
  const trimmed = value.trim();
  if (trimmed === (current ?? '')) return undefined;
  if (trimmed === '') return null;
  return trimmed;
}

/**
 * Multiline edit: compares newline-normalised, trimmed text. A textarea
 * normalizes CRLF to LF, so a plain comparison would mark an untouched IGDB
 * summary as hand-edited. Unchanged → omit; cleared → null; else set.
 */
function multilineDelta(
  value: string,
  current: string | null,
): string | null | undefined {
  const norm = (s: string): string => s.replace(/\r\n?/g, '\n').trim();
  const next = norm(value);
  if (next === norm(current ?? '')) return undefined;
  return next === '' ? null : next;
}

interface DeltaResult {
  delta: UpdateGameRequest;
  errors: FieldErrors;
}

/**
 * Only changed keys are sent: `PATCH /games/:id` marks every present tracked
 * field as hand-edited, so echoing untouched fields would pollute provenance.
 */
function buildDelta(
  game: GameDetail,
  draft: Draft,
  t: TranslatorFor<'gameEdit'>,
): DeltaResult {
  const delta: UpdateGameRequest = {};
  const errors: FieldErrors = {};

  const title = draft.title.trim();
  if (title === '') {
    errors.title = t('error.titleRequired');
  } else if (title !== game.title) {
    delta.title = title;
  }

  if (
    draft.platformId !== '' &&
    isUuidV7(draft.platformId) &&
    draft.platformId !== game.platformId
  ) {
    delta.platformId = draft.platformId;
  }

  const edition = textDelta(draft.edition, game.edition);
  if (edition !== undefined) delta.edition = edition;

  const publisher = textDelta(draft.publisher, game.publisher);
  if (publisher !== undefined) delta.publisher = publisher;

  const genre = textDelta(draft.genre, game.genre);
  if (genre !== undefined) delta.genre = genre;

  const releaseYear = boundedInt(draft.releaseYear, 1000, 2100);
  if (releaseYear === 'invalid') {
    errors.releaseYear = t('error.yearRange');
  } else if (releaseYear === undefined) {
    if (game.releaseYear !== null) delta.releaseYear = null;
  } else if (releaseYear !== game.releaseYear) {
    delta.releaseYear = releaseYear;
  }

  const playerCount = boundedInt(draft.playerCount, 1, 100);
  if (playerCount === 'invalid') {
    errors.playerCount = t('error.playersRange');
  } else if (playerCount === undefined) {
    if (game.playerCount !== null) delta.playerCount = null;
  } else if (playerCount !== game.playerCount) {
    delta.playerCount = playerCount;
  }

  const summary = multilineDelta(draft.summary, game.summary);
  if (summary !== undefined) delta.summary = summary;

  return { delta, errors };
}

export function GameEditForm({
  game,
  platforms,
}: {
  game: GameDetail;
  platforms: GamePlatform[];
}): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('gameEdit');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(game));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const syncedUpdatedAtRef = useRef(game.updatedAt);
  const syncedGameRef = useRef(game);
  const savingRef = useRef(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Reconcile against an external refresh (e.g. re-enrich) without discarding
  // the "Saved." banner, an in-flight save, or unsaved edits.
  useEffect(() => {
    if (game.updatedAt === syncedUpdatedAtRef.current) {
      syncedGameRef.current = game;
      return;
    }
    const previous = syncedGameRef.current;
    syncedUpdatedAtRef.current = game.updatedAt;
    syncedGameRef.current = game;
    if (savingRef.current) return;
    setDraft((current) => mergeDraft(previous, current, toDraft(game)));
  }, [game]);

  /** Close the disclosure and return focus to its toggle (which stays mounted). */
  const closeEditor = useCallback((): void => {
    setOpen(false);
    toggleRef.current?.focus();
  }, []);

  // Move focus into the disclosure when it opens, and close it on Escape.
  useEffect(() => {
    if (open) titleInputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') closeEditor();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, closeEditor]);

  const { delta, errors } = buildDelta(game, draft, t);
  const hasChanges = Object.keys(delta).length > 0;
  const hasErrors = Object.keys(errors).length > 0;

  function setField(key: keyof Draft, value: string): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(
    event: React.SubmitEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (saving || hasErrors || !hasChanges) return;
    setSaving(true);
    savingRef.current = true;
    setError(null);
    setSaved(false);
    try {
      const updated = await api.games.update(game.id, delta);
      setSaved(true);
      setDraft(toDraft(updated));
      closeEditor();
      router.refresh();
    } catch (caught) {
      if (isApiError(caught) && caught.status === 404) {
        router.refresh();
        setError(t('error.notFound'));
        return;
      }
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }
      if (
        isApiError(caught) &&
        (caught.status === 400 || caught.status === 422)
      ) {
        setError(caught.userMessage);
        return;
      }
      setError(t('error.generic'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls="game-edit-form"
        onClick={() => {
          if (open) {
            closeEditor();
            return;
          }
          setSaved(false);
          setError(null);
          setOpen(true);
        }}
        className="inline-flex items-center justify-center rounded-control border border-edge bg-surface px-4 py-2.5 text-sm leading-none font-medium text-ink transition-colors duration-[140ms] ease-[ease] hover:border-edge-strong motion-reduce:transition-none disabled:opacity-60"
      >
        {open ? t('toggleClose') : t('toggleOpen')}
      </button>

      {open && (
        <form
          id="game-edit-form"
          noValidate
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
          className="w-full space-y-4 rounded-card border border-edge bg-surface p-4"
        >
          {error !== null && (
            <p
              role="alert"
              className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {error}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="edit-title" className={LABEL}>
                {t('field.title')}
              </label>
              <input
                ref={titleInputRef}
                id="edit-title"
                name="title"
                type="text"
                required
                maxLength={255}
                value={draft.title}
                onChange={(event) => {
                  setField('title', event.target.value);
                }}
                className={FIELD}
              />
              {errors.title !== undefined && (
                <p className="text-xs text-danger">{errors.title}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="edit-platform" className={LABEL}>
                {t('field.platform')}
              </label>
              <select
                id="edit-platform"
                name="platformId"
                value={draft.platformId}
                onChange={(event) => {
                  setField('platformId', event.target.value);
                }}
                className={`${FIELD} select-field`}
              >
                {platforms.map((platform) => (
                  <option key={platform.id} value={platform.id}>
                    {platform.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="edit-edition" className={LABEL}>
                {t('field.edition')}
              </label>
              <input
                id="edit-edition"
                name="edition"
                type="text"
                maxLength={255}
                value={draft.edition}
                onChange={(event) => {
                  setField('edition', event.target.value);
                }}
                className={FIELD}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="edit-year" className={LABEL}>
                {t('field.releaseYear')}
              </label>
              <input
                id="edit-year"
                name="releaseYear"
                type="text"
                inputMode="numeric"
                pattern="\d*"
                maxLength={4}
                value={draft.releaseYear}
                onChange={(event) => {
                  setField('releaseYear', event.target.value);
                }}
                className={FIELD}
              />
              {errors.releaseYear !== undefined && (
                <p className="text-xs text-danger">{errors.releaseYear}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="edit-player-count" className={LABEL}>
                {t('field.players')}
              </label>
              <input
                id="edit-player-count"
                name="playerCount"
                type="text"
                inputMode="numeric"
                pattern="\d*"
                maxLength={3}
                value={draft.playerCount}
                onChange={(event) => {
                  setField('playerCount', event.target.value);
                }}
                className={FIELD}
              />
              {errors.playerCount !== undefined && (
                <p className="text-xs text-danger">{errors.playerCount}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="edit-publisher" className={LABEL}>
                {t('field.publisher')}
              </label>
              <input
                id="edit-publisher"
                name="publisher"
                type="text"
                maxLength={255}
                value={draft.publisher}
                onChange={(event) => {
                  setField('publisher', event.target.value);
                }}
                className={FIELD}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="edit-genre" className={LABEL}>
                {t('field.genre')}
              </label>
              <input
                id="edit-genre"
                name="genre"
                type="text"
                maxLength={255}
                value={draft.genre}
                onChange={(event) => {
                  setField('genre', event.target.value);
                }}
                className={FIELD}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="edit-summary" className={LABEL}>
                {t('field.summary')}
              </label>
              <textarea
                id="edit-summary"
                name="summary"
                rows={6}
                maxLength={16000}
                value={draft.summary}
                onChange={(event) => {
                  setField('summary', event.target.value);
                }}
                className={TEXTAREA}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saving || hasErrors || !hasChanges}
              className="inline-flex items-center justify-center rounded-control bg-accent px-4 py-2.5 text-sm leading-none font-semibold text-accent-ink transition-colors duration-[140ms] ease-[ease] hover:bg-accent-strong motion-reduce:transition-none disabled:opacity-60"
            >
              {saving ? t('saving') : t('save')}
            </button>
            {!hasChanges && !hasErrors && (
              <span className="text-sm text-muted">{t('noChanges')}</span>
            )}
          </div>
        </form>
      )}

      {saved && (
        <p
          role="status"
          aria-live="polite"
          className="w-full rounded-control border border-edge bg-surface px-3 py-2 text-sm text-muted"
        >
          {t('saved')}
        </p>
      )}
    </>
  );
}
