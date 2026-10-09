'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { isApiError } from '@/lib/api';
import { api } from '@/lib/api/browser';

export function DeleteGameButton({
  gameId,
  title,
}: {
  gameId: number;
  title: string;
}): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('deleteGame');
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  const labelId = useId();
  const descriptionId = useId();

  // Least-destructive default: focus Cancel when the confirmation opens.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  // On cancel the focused Cancel button unmounts; return focus to the trigger
  // instead of letting it fall to <body>.
  useEffect(() => {
    if (!confirming && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [confirming]);

  function cancel(): void {
    restoreFocusRef.current = true;
    setConfirming(false);
  }

  useEffect(() => {
    if (!confirming) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        restoreFocusRef.current = true;
        setConfirming(false);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [confirming]);

  async function handleConfirm(): Promise<void> {
    setDeleting(true);
    setError(null);
    try {
      await api.games.remove(gameId);
      router.push('/');
      router.refresh();
      return;
    } catch (caught) {
      // Already gone is the outcome the user wanted; still navigate away.
      if (isApiError(caught) && caught.status === 404) {
        router.push('/');
        router.refresh();
        return;
      }
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }
      setError(
        isApiError(caught) && caught.status !== 0
          ? caught.userMessage
          : t('error.generic'),
      );
    } finally {
      setDeleting(false);
    }
  }

  if (confirming) {
    return (
      <div
        role="alertdialog"
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        className="rounded-control border border-danger/40 bg-danger/5 p-4"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const first = cancelRef.current;
          const last = confirmRef.current;
          if (first === null || last === null) return;
          // While `deleting`, both buttons are disabled and can't take focus;
          // leave Tab to the browser instead of trapping focus on nothing.
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
        <p id={labelId} className="text-sm font-medium text-ink">
          {t('confirmTitle', { title })}
        </p>
        <p id={descriptionId} className="mt-1 text-sm text-muted">
          {t('confirmBody')}
        </p>
        {error !== null && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={cancel}
            disabled={deleting}
            className="inline-flex items-center justify-center rounded-control border border-edge bg-surface px-4 py-2.5 text-sm leading-none font-medium text-ink transition-colors duration-[140ms] ease-[ease] hover:border-edge-strong motion-reduce:transition-none disabled:opacity-60"
          >
            {t('cancel')}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => {
              void handleConfirm();
            }}
            disabled={deleting}
            className="inline-flex items-center justify-center rounded-control bg-danger px-4 py-2.5 text-sm leading-none font-medium text-danger-ink transition-colors duration-[140ms] ease-[ease] hover:bg-danger/90 motion-reduce:transition-none disabled:opacity-60"
          >
            {deleting ? t('deleting') : t('delete')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        className="inline-flex items-center justify-center rounded-control border border-danger/40 px-4 py-2.5 text-sm leading-none font-medium text-danger transition-colors duration-[140ms] ease-[ease] hover:bg-danger/10 motion-reduce:transition-none disabled:opacity-60"
      >
        {t('open')}
      </button>
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
