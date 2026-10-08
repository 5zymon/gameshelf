import { getTranslations } from 'next-intl/server';
import { GameDatabaseStatusPanel } from '@/components/game-database-status';
import { LlmSettingsForm } from '@/components/llm-settings-form';
import { PreferencesForm } from '@/components/preferences-form';
import { RefreshPlatformsControl } from '@/components/refresh-platforms-control';
import { requireUser } from '@/lib/auth';
import {
  getGameDatabaseStatus,
  getLlmSettings,
  getPreferences,
} from '@/lib/api/server';

export const dynamic = 'force-dynamic';

export default async function SettingsPage(): Promise<React.ReactElement> {
  await requireUser();
  const t = await getTranslations('settings');
  const [llm, dbs, prefs] = await Promise.allSettled([
    getLlmSettings(),
    getGameDatabaseStatus(),
    getPreferences(),
  ]);
  const settings = llm.status === 'fulfilled' ? llm.value : null;
  const databases = dbs.status === 'fulfilled' ? dbs.value : null;
  // 401 → null (defensive: the layout's requireUser already redirected) or a
  // rejected fetch. Without a language value the form has nothing to
  // preselect, so the section is skipped rather than shown with a guess.
  const preferences = prefs.status === 'fulfilled' ? prefs.value : null;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('title')}
        </h1>
        <p className="text-sm text-muted">{t('subtitle')}</p>
      </header>

      {preferences !== null && (
        <section>
          <PreferencesForm language={preferences.language} />
        </section>
      )}

      {settings === null ? (
        <p className="text-sm text-danger" role="alert">
          {t('loadError')}
        </p>
      ) : (
        <LlmSettingsForm settings={settings} />
      )}

      <GameDatabaseStatusPanel statuses={databases} />

      <RefreshPlatformsControl />
    </section>
  );
}
