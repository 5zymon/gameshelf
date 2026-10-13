'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import type { TranslatorFor } from '@/i18n/translate';
import {
  isApiError,
  isGameConflict,
  type GameDetail,
  type GamePlatform,
} from '@/lib/api';
import { api } from '@/lib/api/browser';
import {
  buildCreateRequest,
  emptyManualAddDraft,
  MANUAL_ADD_FIELDS,
  mapServerErrors,
  type ManualAddDraft,
  type ManualAddField,
  type ManualAddFieldErrors,
} from '@/lib/manual-add';

const FIELD =
  'w-full h-10 rounded-control border border-edge bg-field px-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent/55 focus:ring-[3px] focus:ring-accent/15 disabled:opacity-60';
const LABEL = 'block text-sm text-muted';
const PRIMARY_BUTTON =
  'inline-flex items-center justify-center rounded-control bg-accent px-4 py-2.5 text-sm leading-none font-semibold text-accent-ink transition-colors duration-[140ms] ease-[ease] hover:bg-accent-strong motion-reduce:transition-none disabled:opacity-60';
const SECONDARY_BUTTON =
  'inline-flex items-center justify-center rounded-control border border-edge bg-surface px-4 py-2.5 text-sm leading-none font-medium text-ink transition-colors duration-[140ms] ease-[ease] hover:border-edge-strong motion-reduce:transition-none disabled:opacity-60';

type Intent = 'save' | 'save-and-add-another';

/** Which submit button was pressed; the first button is the implicit Enter default. */
function readIntent(event: React.SubmitEvent<HTMLFormElement>): Intent {
  const submitter = event.nativeEvent.submitter;
  return submitter instanceof HTMLButtonElement &&
    submitter.value === 'save-and-add-another'
    ? 'save-and-add-another'
    : 'save';
}

function savedMessage(
  game: GameDetail,
  intent: Intent,
  t: TranslatorFor<'manualAdd'>,
): string {
  const base =
    intent === 'save-and-add-another'
      ? t('savedAndAnother', { title: game.title })
      : t('saved', { title: game.title });
  return game.externalId === null ? `${base} ${t('notLinked')}` : base;
}

export interface ManualAddFormProps {
  platforms: GamePlatform[];
  /** Prefilled title, e.g. a flagged item's raw title. Default ''. */
  initialTitle?: string;
  /** Prefilled platform id (the select's string value). Default ''. */
  initialPlatformId?: string;
  /** Primary submit label. Defaults to the translated `saveGame` message. */
  submitLabel?: string;
  /** Called with the created game after a successful save. */
  onSaved?: (game: GameDetail) => void;
}

export function ManualAddForm({
  platforms: initialPlatforms,
  initialTitle = '',
  initialPlatformId = '',
  submitLabel,
  onSaved,
}: ManualAddFormProps): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('manualAdd');
  // The inline platform-create Cancel reuses the shared common label.
  const tCommon = useTranslations('common');
  // DOM ids come from `useId` so several forms can share one document (e.g. a
  // manual-add form per flagged item) without label/description collisions.
  const uid = useId();
  const [platforms, setPlatforms] = useState<GamePlatform[]>(initialPlatforms);
  const [draft, setDraft] = useState<ManualAddDraft>(() => ({
    ...emptyManualAddDraft(initialPlatformId),
    title: initialTitle,
  }));
  const [fieldErrors, setFieldErrors] = useState<ManualAddFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<GameDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<GameDetail | null>(null);
  const [addingCopy, setAddingCopy] = useState(false);
  const [platformOpen, setPlatformOpen] = useState(false);
  const [newPlatformName, setNewPlatformName] = useState('');
  const [platformError, setPlatformError] = useState<string | null>(null);
  const [creatingPlatform, setCreatingPlatform] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const platformSelectRef = useRef<HTMLSelectElement>(null);
  const newPlatformRef = useRef<HTMLInputElement>(null);
  const conflictDismissRef = useRef<HTMLButtonElement>(null);

  const busy = saving || addingCopy;

  // Least-destructive default: focus the dismiss action when the prompt opens.
  useEffect(() => {
    if (conflict !== null) conflictDismissRef.current?.focus();
  }, [conflict]);

  // The inline platform create is keyboard-first: focus its input on open.
  useEffect(() => {
    if (platformOpen) newPlatformRef.current?.focus();
  }, [platformOpen]);

  useEffect(() => {
    if (conflict === null) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setConflict(null);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [conflict]);

  function setField(key: ManualAddField, value: string): void {
    setDraft((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) =>
      current[key] === undefined ? current : { ...current, [key]: undefined },
    );
    setFormError(null);
    setConflict(null);
  }

  function focusFirstError(errors: ManualAddFieldErrors): void {
    const first = MANUAL_ADD_FIELDS.find((key) => errors[key] !== undefined);
    if (first !== undefined) {
      formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
    }
  }

  async function handleSubmit(
    event: React.SubmitEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (busy) return;

    const intent = readIntent(event);
    const { request, errors } = buildCreateRequest(draft, t);
    if (request === null) {
      setFieldErrors(errors);
      setFormError(null);
      focusFirstError(errors);
      return;
    }

    const keptPlatformId = draft.platformId;
    setSaving(true);
    setFormError(null);
    setFieldErrors({});
    setStatus(null);
    setConflict(null);
    try {
      const created = await api.games.create(request);
      setStatus(savedMessage(created, intent, t));
      setLastCreated(created);
      onSaved?.(created);
      setPlatformError(null);
      setDraft(emptyManualAddDraft(keptPlatformId));
      titleRef.current?.focus();
    } catch (caught) {
      if (isGameConflict(caught)) {
        setConflict(caught.body.game);
        return;
      }
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }
      if (isApiError(caught) && caught.status === 400) {
        const mapped = mapServerErrors(caught.messages);
        setFieldErrors(mapped.fieldErrors);
        setFormError(mapped.formError);
        focusFirstError(mapped.fieldErrors);
        return;
      }
      setFormError(
        isApiError(caught) && caught.status !== 0
          ? caught.userMessage
          : t('error.generic'),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleAddCopy(): Promise<void> {
    if (conflict === null || addingCopy) return;
    const target = conflict;
    setAddingCopy(true);
    setFormError(null);
    try {
      const updated = await api.games.addCopy(target.id);
      setStatus(
        t('addCopyStatus', { title: updated.title, count: updated.copyCount }),
      );
      setLastCreated(updated);
      onSaved?.(updated);
      setConflict(null);
      setDraft(emptyManualAddDraft(draft.platformId));
      titleRef.current?.focus();
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }
      setFormError(
        isApiError(caught) && caught.status !== 0
          ? caught.userMessage
          : t('error.copyGeneric'),
      );
    } finally {
      setAddingCopy(false);
    }
  }

  function addPlatform(platform: GamePlatform): void {
    setPlatforms((current) =>
      current.some((item) => item.id === platform.id)
        ? current
        : [...current, platform],
    );
  }

  function togglePlatformCreate(): void {
    setPlatformError(null);
    if (platformOpen) setNewPlatformName('');
    setPlatformOpen((current) => !current);
  }

  function cancelPlatformCreate(): void {
    setPlatformOpen(false);
    setNewPlatformName('');
    setPlatformError(null);
    platformSelectRef.current?.focus();
  }

  /** A 409 means the name already exists; reload and select the existing row. */
  async function refreshPlatformsAndFind(name: string): Promise<string | null> {
    const list = await api.platforms.list();
    const mapped: GamePlatform[] = list.map((platform) => ({
      id: platform.id,
      name: platform.name,
      slug: platform.slug,
    }));
    setPlatforms(mapped);
    const target = name.trim().toLowerCase();
    const match = mapped.find(
      (platform) => platform.name.trim().toLowerCase() === target,
    );
    if (match === undefined) return null;
    setDraft((current) => ({ ...current, platformId: match.id }));
    return match.id;
  }

  async function handleCreatePlatform(): Promise<void> {
    const name = newPlatformName.trim();
    if (name === '') {
      setPlatformError(t('error.platformNameRequired'));
      return;
    }
    setCreatingPlatform(true);
    setPlatformError(null);
    try {
      const created = await api.platforms.create({ name });
      addPlatform({ id: created.id, name: created.name, slug: created.slug });
      setDraft((current) => ({ ...current, platformId: created.id }));
      setPlatformOpen(false);
      setNewPlatformName('');
      platformSelectRef.current?.focus();
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }
      if (isApiError(caught) && caught.status === 409) {
        const selected = await refreshPlatformsAndFind(name).catch(() => null);
        if (selected !== null) {
          setPlatformOpen(false);
          setNewPlatformName('');
          platformSelectRef.current?.focus();
          return;
        }
      }
      setPlatformError(
        isApiError(caught) && caught.status !== 0
          ? caught.userMessage
          : t('error.platformGeneric'),
      );
    } finally {
      setCreatingPlatform(false);
    }
  }

  const conflictMeta = [
    conflict?.platform.name ?? null,
    conflict?.edition ?? null,
    conflict === null ? null : t('copyCount', { count: conflict.copyCount }),
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="space-y-6"
    >
      {formError !== null && (
        <p
          role="alert"
          className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {formError}
        </p>
      )}

      {status !== null && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-control border border-edge bg-surface px-3 py-2 text-sm text-muted"
        >
          {status}
          {lastCreated !== null && (
            <>
              {' '}
              <Link
                href={`/games/${lastCreated.id}`}
                className="text-accent-text underline-offset-4 hover:underline"
              >
                {t('viewGame')}
              </Link>
            </>
          )}
        </p>
      )}

      {conflict !== null && (
        <div
          role="alertdialog"
          aria-labelledby={`${uid}-conflict-title`}
          aria-describedby={`${uid}-conflict-body`}
          className="rounded-card border border-accent/40 bg-accent-soft p-4"
        >
          <p
            id={`${uid}-conflict-title`}
            className="text-sm font-medium text-ink"
          >
            {t('conflict.title', { title: conflict.title })}
          </p>
          <p id={`${uid}-conflict-body`} className="mt-1 text-sm text-muted">
            {t('conflict.body', { meta: conflictMeta })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              ref={conflictDismissRef}
              type="button"
              onClick={() => {
                setConflict(null);
                titleRef.current?.focus();
              }}
              disabled={addingCopy}
              className={SECONDARY_BUTTON}
            >
              {t('notNow')}
            </button>
            <button
              type="button"
              onClick={() => {
                void handleAddCopy();
              }}
              disabled={addingCopy}
              className={PRIMARY_BUTTON}
            >
              {addingCopy ? t('adding') : t('addAnotherCopy')}
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-3 rounded-card border border-edge bg-surface p-4 shadow-[var(--shadow-card)] sm:grid-cols-2 sm:p-6">
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor={`${uid}-title`} className={LABEL}>
            {t('field.title')}
          </label>
          <input
            id={`${uid}-title`}
            name="title"
            type="text"
            ref={titleRef}
            required
            maxLength={255}
            value={draft.title}
            onChange={(event) => {
              setField('title', event.target.value);
            }}
            className={FIELD}
            aria-invalid={fieldErrors.title !== undefined}
            aria-describedby={
              fieldErrors.title !== undefined ? `${uid}-title-error` : undefined
            }
          />
          {fieldErrors.title !== undefined && (
            <p id={`${uid}-title-error`} className="text-xs text-danger">
              {fieldErrors.title}
            </p>
          )}
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor={`${uid}-platform`} className={LABEL}>
            {t('field.platform')}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id={`${uid}-platform`}
              name="platformId"
              ref={platformSelectRef}
              value={draft.platformId}
              onChange={(event) => {
                setField('platformId', event.target.value);
              }}
              className={`${FIELD} select-field sm:max-w-xs`}
              aria-invalid={fieldErrors.platformId !== undefined}
              aria-describedby={
                fieldErrors.platformId !== undefined
                  ? `${uid}-platform-error`
                  : undefined
              }
            >
              <option value="" disabled>
                {t('choosePlatform')}
              </option>
              {platforms.map((platform) => (
                <option key={platform.id} value={platform.id}>
                  {platform.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-expanded={platformOpen}
              onClick={togglePlatformCreate}
              className={SECONDARY_BUTTON}
            >
              {platformOpen ? t('closeNewPlatform') : t('newPlatform')}
            </button>
          </div>
          {platforms.length === 0 && !platformOpen && (
            <p className="text-xs text-muted">{t('noPlatforms')}</p>
          )}
          {platformOpen && (
            <div className="mt-2 rounded-control border border-edge bg-canvas p-3">
              <label htmlFor={`${uid}-new-platform`} className={LABEL}>
                {t('newPlatformName')}
              </label>
              <input
                id={`${uid}-new-platform`}
                ref={newPlatformRef}
                type="text"
                maxLength={255}
                value={newPlatformName}
                onChange={(event) => {
                  setNewPlatformName(event.target.value);
                  setPlatformError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelPlatformCreate();
                  }
                  if (
                    event.key === 'Enter' &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.altKey &&
                    !event.shiftKey
                  ) {
                    event.preventDefault();
                    if (!creatingPlatform) {
                      void handleCreatePlatform();
                    }
                  }
                }}
                className={`${FIELD} mt-1.5`}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void handleCreatePlatform();
                  }}
                  disabled={creatingPlatform}
                  className={PRIMARY_BUTTON}
                >
                  {creatingPlatform ? t('creating') : t('createPlatform')}
                </button>
                <button
                  type="button"
                  onClick={cancelPlatformCreate}
                  disabled={creatingPlatform}
                  className={SECONDARY_BUTTON}
                >
                  {tCommon('cancel')}
                </button>
              </div>
            </div>
          )}
          {fieldErrors.platformId !== undefined && (
            <p id={`${uid}-platform-error`} className="text-xs text-danger">
              {fieldErrors.platformId}
            </p>
          )}
          {platformError !== null && (
            <p role="alert" className="text-xs text-danger">
              {platformError}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${uid}-edition`} className={LABEL}>
            {t('field.edition')}
          </label>
          <input
            id={`${uid}-edition`}
            name="edition"
            type="text"
            maxLength={255}
            value={draft.edition}
            onChange={(event) => {
              setField('edition', event.target.value);
            }}
            className={FIELD}
            aria-invalid={fieldErrors.edition !== undefined}
            aria-describedby={
              fieldErrors.edition !== undefined
                ? `${uid}-edition-error`
                : undefined
            }
          />
          {fieldErrors.edition !== undefined && (
            <p id={`${uid}-edition-error`} className="text-xs text-danger">
              {fieldErrors.edition}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${uid}-year`} className={LABEL}>
            {t('field.releaseYear')}
          </label>
          <input
            id={`${uid}-year`}
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
            aria-invalid={fieldErrors.releaseYear !== undefined}
            aria-describedby={
              fieldErrors.releaseYear !== undefined
                ? `${uid}-year-error`
                : undefined
            }
          />
          {fieldErrors.releaseYear !== undefined && (
            <p id={`${uid}-year-error`} className="text-xs text-danger">
              {fieldErrors.releaseYear}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${uid}-players`} className={LABEL}>
            {t('field.players')}
          </label>
          <input
            id={`${uid}-players`}
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
            aria-invalid={fieldErrors.playerCount !== undefined}
            aria-describedby={
              fieldErrors.playerCount !== undefined
                ? `${uid}-players-error`
                : undefined
            }
          />
          {fieldErrors.playerCount !== undefined && (
            <p id={`${uid}-players-error`} className="text-xs text-danger">
              {fieldErrors.playerCount}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${uid}-publisher`} className={LABEL}>
            {t('field.publisher')}
          </label>
          <input
            id={`${uid}-publisher`}
            name="publisher"
            type="text"
            maxLength={255}
            value={draft.publisher}
            onChange={(event) => {
              setField('publisher', event.target.value);
            }}
            className={FIELD}
            aria-invalid={fieldErrors.publisher !== undefined}
            aria-describedby={
              fieldErrors.publisher !== undefined
                ? `${uid}-publisher-error`
                : undefined
            }
          />
          {fieldErrors.publisher !== undefined && (
            <p id={`${uid}-publisher-error`} className="text-xs text-danger">
              {fieldErrors.publisher}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${uid}-genre`} className={LABEL}>
            {t('field.genre')}
          </label>
          <input
            id={`${uid}-genre`}
            name="genre"
            type="text"
            maxLength={255}
            value={draft.genre}
            onChange={(event) => {
              setField('genre', event.target.value);
            }}
            className={FIELD}
            aria-invalid={fieldErrors.genre !== undefined}
            aria-describedby={
              fieldErrors.genre !== undefined ? `${uid}-genre-error` : undefined
            }
          />
          {fieldErrors.genre !== undefined && (
            <p id={`${uid}-genre-error`} className="text-xs text-danger">
              {fieldErrors.genre}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          name="intent"
          value="save"
          disabled={busy}
          className={PRIMARY_BUTTON}
        >
          {saving ? t('saving') : (submitLabel ?? t('saveGame'))}
        </button>
        <button
          type="submit"
          name="intent"
          value="save-and-add-another"
          disabled={busy}
          className={SECONDARY_BUTTON}
        >
          {saving ? t('saving') : t('saveAndAddAnother')}
        </button>
      </div>
    </form>
  );
}
