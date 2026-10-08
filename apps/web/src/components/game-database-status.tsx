import type { GameDatabaseState, GameDatabaseStatus } from '@/lib/api';

function stateLabel(state: GameDatabaseState): string {
  switch (state) {
    case 'configured':
      return 'Configured';
    case 'missing':
      return 'Not configured';
    case 'rejected':
      return 'Key rejected';
  }
}

function stateClass(state: GameDatabaseState): string {
  switch (state) {
    case 'configured':
      return 'text-fog';
    case 'missing':
      return 'text-muted';
    case 'rejected':
      return 'text-danger';
  }
}

export function GameDatabaseStatusPanel({
  statuses,
}: {
  statuses: GameDatabaseStatus[] | null;
}): React.ReactElement {
  return (
    <section
      className="space-y-3 rounded-xl border border-edge bg-shelf/40 p-4"
      aria-labelledby="gamedb-heading"
    >
      <h2 id="gamedb-heading" className="text-lg font-medium text-fog">
        Game databases
      </h2>
      {statuses === null ? (
        <p role="status" className="text-sm text-muted">
          Couldn’t load game-database status.
        </p>
      ) : (
        <ul className="space-y-2">
          {statuses.map((db) => (
            <li
              key={db.id}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <span className="text-fog">{db.label}</span>
              <span className={stateClass(db.state)}>
                {stateLabel(db.state)}
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
