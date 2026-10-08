'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { isApiError, type AppLanguage, type AppTheme } from '@/lib/api';
import { api } from '@/lib/api/browser';
import { useTheme } from '@/components/theme-provider';

/**
 * Per-user UI language + theme switcher (tickets 7.2/7.3). The PUT rewrites
 * the `NEXT_LOCALE` and `NEXT_THEME` cookies on the response, so
 * `router.refresh()` re-renders the server components with the new catalog
 * and theme on the next navigation. The theme is also applied to the
 * document immediately via `setTheme` so the switch is visible at once.
 */
export function PreferencesForm({
  language,
  theme,
}: {
  language: AppLanguage;
  theme: AppTheme;
}): React.ReactElement {
  const t = useTranslations('preferences');
  const router = useRouter();
  const { setTheme } = useTheme();
  const [languageValue, setLanguageValue] = useState<AppLanguage>(language);
  const [themeValue, setThemeValue] = useState<AppTheme>(theme);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  const unchanged = languageValue === language && themeValue === theme;

  async function onSubmit(
    event: React.SubmitEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (saving || unchanged) return;
    setSaving(true);
    setError(false);
    setSaved(false);
    try {
      await api.settings.preferences.put({
        language: languageValue,
        theme: themeValue,
      });
      setTheme(themeValue); // visible immediately; the cookie is already set
      setSaved(true);
      router.refresh(); // re-renders server components with the new cookies
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
        value={languageValue}
        onChange={(event) => {
          setLanguageValue(event.target.value as AppLanguage);
          setSaved(false);
        }}
        className="w-full rounded-md border border-edge bg-ink px-3 py-2 text-fog outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <option value="pl">{t('languageName.pl')}</option>
        <option value="en">{t('languageName.en')}</option>
      </select>
      <label htmlFor="pref-theme" className="block text-sm text-muted">
        {t('theme')}
      </label>
      <select
        id="pref-theme"
        value={themeValue}
        onChange={(event) => {
          setThemeValue(event.target.value as AppTheme);
          setSaved(false);
        }}
        className="w-full rounded-md border border-edge bg-ink px-3 py-2 text-fog outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <option value="light">{t('themeName.light')}</option>
        <option value="dark">{t('themeName.dark')}</option>
        <option value="system">{t('themeName.system')}</option>
      </select>
      <button
        type="submit"
        disabled={saving || unchanged}
        className="rounded-md bg-accent px-4 py-2 font-medium text-on-accent hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong disabled:opacity-60"
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
