'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { isApiError, type AppLanguage, type AppTheme } from '@/lib/api';
import { api } from '@/lib/api/browser';
import { useTheme } from '@/components/theme-provider';

const FIELD =
  'w-full h-10 rounded-control border border-edge bg-field px-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent/55 focus:ring-[3px] focus:ring-accent/15 disabled:opacity-60';
const PRIMARY_BUTTON =
  'inline-flex items-center justify-center rounded-control bg-accent px-4 py-2.5 text-sm leading-none font-semibold text-accent-ink transition-colors duration-[140ms] ease-[ease] hover:bg-accent-strong motion-reduce:transition-none disabled:opacity-60';

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
      className="space-y-3 rounded-card border border-edge bg-surface p-4 shadow-[var(--shadow-card)]"
    >
      <h2 className="text-lg font-semibold text-ink">{t('heading')}</h2>
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
        className={`${FIELD} select-field`}
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
        className={`${FIELD} select-field`}
      >
        <option value="light">{t('themeName.light')}</option>
        <option value="dark">{t('themeName.dark')}</option>
        <option value="system">{t('themeName.system')}</option>
      </select>
      <button
        type="submit"
        disabled={saving || unchanged}
        className={PRIMARY_BUTTON}
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
