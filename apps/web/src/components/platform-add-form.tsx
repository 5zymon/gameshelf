'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { isApiError } from '@/lib/api';
import { api } from '@/lib/api/browser';
import { platformErrorMessage } from '@/lib/platforms';

const FIELD =
  'w-full rounded-md border border-edge bg-ink px-3 py-2 text-fog outline-none focus-visible:ring-2 focus-visible:ring-accent';
const LABEL = 'block text-sm text-muted';
const PRIMARY_BUTTON =
  'rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong disabled:opacity-60';

export function PlatformAddForm({
  onChanged,
}: {
  onChanged: () => void;
}): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('platforms');
  const uid = useId();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const trimmed = name.trim();
  const disabled = busy || trimmed === '';

  async function handleSubmit(
    event: React.SubmitEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (disabled) return;
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      await api.platforms.create({ name: trimmed });
      setName('');
      onChanged();
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }
      if (isApiError(caught) && caught.status === 409) {
        setConflict(true);
        setError(caught.userMessage);
        return;
      }
      setError(platformErrorMessage(caught, t('error.add')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby={`${uid}-heading`}
      className="space-y-3 rounded-xl border border-edge bg-shelf/40 p-4"
    >
      <div className="space-y-1">
        <h2 id={`${uid}-heading`} className="text-lg font-medium text-fog">
          {t('add.title')}
        </h2>
        <p className="text-sm text-muted">{t('add.body')}</p>
      </div>
      <form
        noValidate
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <label htmlFor={`${uid}-name`} className={LABEL}>
            {t('name')}
          </label>
          <input
            id={`${uid}-name`}
            type="text"
            maxLength={255}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
              setConflict(false);
            }}
            className={FIELD}
            aria-invalid={error !== null}
            aria-describedby={error !== null ? `${uid}-error` : undefined}
          />
        </div>
        <button type="submit" disabled={disabled} className={PRIMARY_BUTTON}>
          {busy ? t('adding') : t('addPlatform')}
        </button>
      </form>
      {error !== null && (
        <p id={`${uid}-error`} role="alert" className="text-sm text-danger">
          {error}
          {conflict && (
            <span className="mt-0.5 block text-xs text-muted">
              {t('add.conflict')}
            </span>
          )}
        </p>
      )}
    </section>
  );
}
