import { getTranslations } from 'next-intl/server';
import type { TranslatorFor } from '@/i18n/translate';
import type { GameDatabaseState, GameDatabaseStatus } from '@/lib/api';

function stateLabel(
  state: GameDatabaseState,
  t: TranslatorFor<'gameDatabases'>,
): string {
  switch (state) {
    case 'configured':
      return t('state.configured');
    case 'missing':
      return t('state.missing');
    case 'rejected':
      return t('state.rejected');
  }
}

function stateClass(state: GameDatabaseState): string {
  switch (state) {
    case 'configured':
      return 'text-ink';
    case 'missing':
      return 'text-muted';
    case 'rejected':
      return 'text-danger';
  }
}

export async function GameDatabaseStatusPanel({
  statuses,
}: {
  statuses: GameDatabaseStatus[] | null;
}): Promise<React.ReactElement> {
  const t = await getTranslations('gameDatabases');
  return (
    <section
      className="space-y-3 rounded-card border border-edge bg-surface p-4 shadow-[var(--shadow-card)]"
      aria-labelledby="gamedb-heading"
    >
      <h2 id="gamedb-heading" className="text-lg font-semibold text-ink">
        {t('heading')}
      </h2>
      {statuses === null ? (
        <p role="status" className="text-sm text-muted">
          {t('loadError')}
        </p>
      ) : (
        <ul className="space-y-2">
          {statuses.map((db) => (
            <li
              key={db.id}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <span className="text-ink">{db.label}</span>
              <span className={stateClass(db.state)}>
                {stateLabel(db.state, t)}
              </span>
              {db.state === 'rejected' && db.message !== null && (
                <span className="text-muted">{db.message}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
