'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { isApiError, type AppLanguage } from '@/lib/api';
import { api } from '@/lib/api/browser';

/**
 * Per-user UI language switcher (ticket 7.2). The PUT rewrites the
 * `NEXT_LOCALE` cookie on the response, so `router.refresh()` re-renders the
 * server components with the new catalog on the next navigation.
 */
export function PreferencesForm({
  language,
}: {
  language: AppLanguage;
}): React.ReactElement {
  const t = useTranslations('preferences');
  const router = useRouter();
  const [value, setValue] = useState<AppLanguage>(language);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  async function onSubmit(
    event: React.SubmitEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (saving || value === language) return;
    setSaving(true);
    setError(false);
    setSaved(false);
    try {
      await api.settings.preferences.put({ language: value });
      setSaved(true);
      router.refresh(); // re-renders server components with the NEXT_LOCALE cookie just set
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      className="space-y-3 rounded-xl border border-edge bg-shelf/40 p-4"
    >
      <h2 className="text-lg font-medium text-fog">{t('heading')}</h2>
      <p className="text-sm text-muted">{t('body')}</p>
      <label htmlFor="pref-language" className="block text-sm text-muted">
        {t('language')}
      </label>
      <select
        id="pref-language"
        value={value}
        onChange={(event) => {
          setValue(event.target.value as AppLanguage);
          setSaved(false);
        }}
        className="w-full rounded-md border border-edge bg-ink px-3 py-2 text-fog outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <option value="pl">{t('languageName.pl')}</option>
        <option value="en">{t('languageName.en')}</option>
      </select>
      <button
        type="submit"
        disabled={saving || value === language}
        className="rounded-md bg-accent px-4 py-2 font-medium text-ink hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong disabled:opacity-60"
      >
        {saving ? t('saving') : t('save')}
      </button>
      {saved && (
        <p role="status" aria-live="polite" className="text-sm text-muted">
          {t('saved')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {t('error')}
        </p>
      )}
    </form>
  );
}
