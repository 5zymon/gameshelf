import { GameDatabaseStatusPanel } from '@/components/game-database-status';
import { LlmSettingsForm } from '@/components/llm-settings-form';
import { RefreshPlatformsControl } from '@/components/refresh-platforms-control';
import { requireUser } from '@/lib/auth';
import { getGameDatabaseStatus, getLlmSettings } from '@/lib/api/server';

export const dynamic = 'force-dynamic';

export default async function SettingsPage(): Promise<React.ReactElement> {
  await requireUser();
  const [llm, dbs] = await Promise.allSettled([
    getLlmSettings(),
    getGameDatabaseStatus(),
  ]);
  const settings = llm.status === 'fulfilled' ? llm.value : null;
  const databases = dbs.status === 'fulfilled' ? dbs.value : null;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Settings
        </h1>
        <p className="text-sm text-muted">
          Configure game recognition and game-database access.
        </p>
      </header>

      {settings === null ? (
        <p className="text-sm text-danger" role="alert">
          Couldn’t load the LLM settings. Reload to try again.
        </p>
      ) : (
        <LlmSettingsForm settings={settings} />
      )}

      <GameDatabaseStatusPanel statuses={databases} />

      <RefreshPlatformsControl />
    </section>
  );
}
