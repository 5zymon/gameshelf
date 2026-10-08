'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { isApiError, type Platform } from '@/lib/api';
import { api } from '@/lib/api/browser';
import {
  deleteBlockedHint,
  gameCountLabel,
  platformErrorMessage,
  platformKind,
  platformKindHint,
  platformKindLabel,
  type PlatformKind,
} from '@/lib/platforms';

const FIELD =
  'w-full rounded-md border border-edge bg-ink px-3 py-2 text-fog outline-none focus-visible:ring-2 focus-visible:ring-accent';
const LABEL = 'block text-sm text-muted';
const PRIMARY_BUTTON =
  'rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong disabled:opacity-60';
const SECONDARY_BUTTON =
  'rounded-md border border-edge px-4 py-2 text-sm font-medium text-fog hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60';
const SMALL_BUTTON =
  'rounded-md border border-edge px-3 py-1.5 text-xs font-medium text-fog hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60';
const DANGER_BUTTON =
  'rounded-md border border-danger/40 px-4 py-2 text-sm font-medium text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-60';
const SMALL_DANGER_BUTTON =
  'rounded-md border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-60';
const CHIP = 'rounded-full border px-2 py-0.5 text-xs';

const KIND_CHIP: Readonly<Record<PlatformKind, string>> = {
  import: 'border-accent-strong/50 text-accent-strong',
  canonical: 'border-edge text-muted',
  manual: 'border-edge text-muted',
};

export function PlatformRow({
  platform,
  onChanged,
  onMerge,
}: {
  platform: Platform;
  onChanged: () => void;
  onMerge: (source: Platform) => void;
}): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('platforms');
  // The rename-save busy state reuses the shared saving label.
  const tCommon = useTranslations('common');
  const uid = useId();
  const kind = platformKind(platform);
  // Any linked row (reference, or an import row a sync matched) is hidden,
  // never deleted: the API's `remove` hides when `igdbId != null`. Only a
  // never-linked row gets Delete.
  const isReference = platform.igdbId !== null;

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(platform.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [savingRename, setSavingRename] = useState(false);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState(false);

  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameTriggerRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  const labelId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming]);

  useEffect(() => {
    if (confirmingDelete) cancelRef.current?.focus();
  }, [confirmingDelete]);

  // On cancel the focused Cancel button unmounts; return focus to the trigger.
  useEffect(() => {
    if (!confirmingDelete && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      deleteTriggerRef.current?.focus();
    }
  }, [confirmingDelete]);

  useEffect(() => {
    if (!confirmingDelete) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        restoreFocusRef.current = true;
        setConfirmingDelete(false);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [confirmingDelete]);

  function goToLogin(): void {
    router.replace('/login');
    router.refresh();
  }

  function openRename(): void {
    setStatus(null);
    setRenameError(null);
    setRenameValue(platform.name);
    setRenaming(true);
  }

  function closeRename(): void {
    setRenaming(false);
    setRenameError(null);
    renameTriggerRef.current?.focus();
  }

  function cancelDelete(): void {
    restoreFocusRef.current = true;
    setConfirmingDelete(false);
  }

  async function submitRename(
    event: React.SubmitEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const name = renameValue.trim();
    if (name === '' || savingRename) return;
    setSavingRename(true);
    setRenameError(null);
    try {
      await api.platforms.update(platform.id, { name });
      setRenaming(false);
      setStatus(
        name === platform.name
          ? t('status.unchanged')
          : t('status.renamed', { name }),
      );
      onChanged();
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        goToLogin();
        return;
      }
      if (isApiError(caught) && caught.status === 404) {
        setRenameError(t('error.notFound'));
        onChanged();
        return;
      }
      setRenameError(platformErrorMessage(caught, t('error.rename')));
    } finally {
      setSavingRename(false);
    }
  }

  async function toggleHidden(): Promise<void> {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    setStatus(null);
    const nextHidden = !platform.hidden;
    try {
      // `UpdatePlatformDto.name` is required, so the rendered name is resent.
      // If the row was renamed in another tab in the meantime, the server
      // answers against that newer name rather than this rendered one.
      await api.platforms.update(platform.id, {
        name: platform.name,
        hidden: nextHidden,
      });
      setStatus(
        nextHidden
          ? t('status.hidden', { name: platform.name })
          : t('status.visible', { name: platform.name }),
      );
      onChanged();
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        goToLogin();
        return;
      }
      if (isApiError(caught) && caught.status === 404) {
        setActionError(t('error.notFound'));
        onChanged();
        return;
      }
      setActionError(platformErrorMessage(caught, t('error.update')));
    } finally {
      setActionBusy(false);
    }
  }

  async function confirmImport(): Promise<void> {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    setStatus(null);
    try {
      await api.platforms.confirm(platform.id);
      setStatus(t('status.confirmed', { name: platform.name }));
      onChanged();
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        goToLogin();
        return;
      }
      if (isApiError(caught) && caught.status === 404) {
        setActionError(t('error.notFound'));
        onChanged();
        return;
      }
      setActionError(platformErrorMessage(caught, t('error.confirm')));
    } finally {
      setActionBusy(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    setDeleting(true);
    setDeleteError(null);
    setDeleteBlocked(false);
    try {
      await api.platforms.remove(platform.id);
      setConfirmingDelete(false);
      onChanged();
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        goToLogin();
        return;
      }
      if (isApiError(caught) && caught.status === 404) {
        setConfirmingDelete(false);
        onChanged();
        return;
      }
      if (isApiError(caught) && caught.status === 409) {
        setDeleteError(caught.userMessage);
        setDeleteBlocked(true);
        return;
      }
      setDeleteError(platformErrorMessage(caught, t('error.delete')));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-fog">
              {platform.name}
            </p>
            <span
              title={platformKindHint(kind, t)}
              className={`${CHIP} ${KIND_CHIP[kind]}`}
            >
              {platformKindLabel(kind, t)}
            </span>
            {platform.hidden && (
              <span className={`${CHIP} border-danger/40 text-danger`}>
                {t('hidden')}
              </span>
            )}
          </div>
          <p className="text-xs text-muted">
            {gameCountLabel(platform.gameCount, t)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {platform.addedByImport && (
            <button
              type="button"
              onClick={() => {
                void confirmImport();
              }}
              disabled={actionBusy}
              className={SMALL_BUTTON}
            >
              {t('keepAsIs')}
            </button>
          )}
          <button
            ref={renameTriggerRef}
            type="button"
            aria-expanded={renaming}
            onClick={() => {
              if (renaming) {
                closeRename();
                return;
              }
              openRename();
            }}
            className={SMALL_BUTTON}
          >
            {renaming ? t('closeRename') : t('rename')}
          </button>
          <button
            type="button"
            onClick={() => {
              onMerge(platform);
            }}
            disabled={actionBusy}
            className={SMALL_BUTTON}
          >
            {t('mergeInto')}
          </button>
          {isReference ? (
            <button
              type="button"
              title={t('hideHint')}
              onClick={() => {
                void toggleHidden();
              }}
              disabled={actionBusy}
              className={SMALL_BUTTON}
            >
              {actionBusy
                ? t('working')
                : platform.hidden
                  ? t('show')
                  : t('hide')}
            </button>
          ) : (
            <button
              ref={deleteTriggerRef}
              type="button"
              onClick={() => {
                setDeleteError(null);
                setDeleteBlocked(false);
                setConfirmingDelete(true);
              }}
              disabled={actionBusy}
              className={SMALL_DANGER_BUTTON}
            >
              {t('delete')}
            </button>
          )}
        </div>
      </div>

      {renaming && (
        <form
          noValidate
          onSubmit={(event) => {
            void submitRename(event);
          }}
          className="space-y-2 rounded-lg border border-edge bg-ink/40 p-3"
        >
          <label htmlFor={`${uid}-rename`} className={LABEL}>
            {t('newName')}
          </label>
          <input
            id={`${uid}-rename`}
            ref={renameInputRef}
            type="text"
            maxLength={255}
            value={renameValue}
            onChange={(event) => {
              setRenameValue(event.target.value);
              setRenameError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeRename();
              }
            }}
            className={`${FIELD} max-w-md`}
            aria-invalid={renameError !== null}
            aria-describedby={
              renameError !== null
                ? `${uid}-rename-error`
                : `${uid}-rename-help`
            }
          />
          <p id={`${uid}-rename-help`} className="text-xs text-muted">
            {t('renameHelp')}
          </p>
          {renameError !== null && (
            <p
              id={`${uid}-rename-error`}
              role="alert"
              className="text-xs text-danger"
            >
              {renameError}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={savingRename || renameValue.trim() === ''}
              className={PRIMARY_BUTTON}
            >
              {savingRename ? tCommon('saving') : t('saveName')}
            </button>
            <button
              type="button"
              onClick={closeRename}
              disabled={savingRename}
              className={SECONDARY_BUTTON}
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      )}

      {confirmingDelete && (
        <div
          role="alertdialog"
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          className="rounded-lg border border-danger/40 bg-danger/5 p-3"
          onKeyDown={(event) => {
            if (event.key !== 'Tab') return;
            const first = cancelRef.current;
            const last = confirmRef.current;
            if (first === null || last === null) return;
            if (first.disabled || last.disabled) return;
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }}
        >
          <p id={labelId} className="text-sm font-medium text-fog">
            {t('confirmDelete.title', { name: platform.name })}
          </p>
          <p id={descriptionId} className="mt-1 text-sm text-muted">
            {deleteBlocked
              ? t('confirmDelete.blocked')
              : t('confirmDelete.body')}
          </p>
          {deleteError !== null && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {deleteError}
            </p>
          )}
          {deleteBlocked && (
            <p className="mt-1 text-xs text-muted">{deleteBlockedHint(t)}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={cancelDelete}
              disabled={deleting}
              className={SECONDARY_BUTTON}
            >
              {t('cancel')}
            </button>
            {deleteBlocked ? (
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(false);
                  onMerge(platform);
                }}
                disabled={deleting}
                className={PRIMARY_BUTTON}
              >
                {t('mergeInto')}
              </button>
            ) : (
              <button
                ref={confirmRef}
                type="button"
                onClick={() => {
                  void confirmDelete();
                }}
                disabled={deleting}
                className={DANGER_BUTTON}
              >
                {deleting ? t('deleting') : t('delete')}
              </button>
            )}
          </div>
        </div>
      )}

      {actionError !== null && (
        <p role="alert" className="text-sm text-danger">
          {actionError}
        </p>
      )}
      {status !== null && (
        <p role="status" aria-live="polite" className="text-sm text-muted">
          {status}
        </p>
      )}
    </div>
  );
}
