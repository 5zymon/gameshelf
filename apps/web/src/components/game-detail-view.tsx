import type { GameDetail, GamePlatform } from '@/lib/api';
import { DeleteGameButton } from './delete-game-button';
import { GameCover } from './game-cover';
import { GameEditForm } from './game-edit-form';
import { ReEnrichControl } from './re-enrich-control';

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

/** Deterministic UTC rendering so server and client text never disagree. */
function formatDateTime(value: string | null): string {
  if (value === null) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unknown'
    : DATE_TIME_FORMAT.format(date);
}

function sourceLabel(source: GameDetail['source']): string {
  return source === 'MANUAL' ? 'Manual' : source;
}

/** Pretty-prints the archival `rawMetadata`; falls back to the raw text. */
function prettyRaw(raw: string | null): string {
  if (raw === null) return 'No raw metadata stored.';
  try {
    const parsed: unknown = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

function Chip({
  children,
  tone = 'default',
}: {
  children: React.ReactNode;
  tone?: 'default' | 'muted' | 'danger';
}): React.ReactElement {
  const toneClass =
    tone === 'danger'
      ? 'border-danger/40 bg-danger/10 text-danger'
      : tone === 'muted'
        ? 'border-edge bg-shelf text-muted'
        : 'border-edge bg-shelf text-fog';
  return (
    <span className={`rounded-full border px-3 py-1 text-xs ${toneClass}`}>
      {children}
    </span>
  );
}

function DataRow({
  label,
  value,
  edited = false,
}: {
  label: string;
  value: string | number | null;
  edited?: boolean;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5 border-b border-edge/60 py-2 last:border-b-0">
      <dt className="text-xs tracking-wide text-muted uppercase">{label}</dt>
      <dd className="text-sm text-fog">
        {value === null || value === '' ? (
          <span className="text-muted">Not set</span>
        ) : (
          String(value)
        )}
        {edited && <span className="ml-2 text-xs text-muted">hand-edited</span>}
      </dd>
    </div>
  );
}

export function GameDetailView({
  game,
  platforms,
}: {
  game: GameDetail;
  platforms: GamePlatform[];
}): React.ReactElement {
  const edited = new Set(game.userEditedFields);
  const meta = [
    game.platform.name,
    game.edition,
    game.releaseYear === null ? null : String(game.releaseYear),
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');

  return (
    <article className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs tracking-widest text-accent uppercase">Game</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {game.title}
          </h1>
          {meta !== '' && <p className="text-sm text-muted">{meta}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip>Source: {sourceLabel(game.source)}</Chip>
          <Chip tone="muted">
            {game.enrichedAt === null
              ? 'Never enriched'
              : `Last enriched: ${formatDateTime(game.enrichedAt)}`}
          </Chip>
          {game.platformUnverified && (
            <Chip tone="danger">Platform unverified</Chip>
          )}
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
        <div className="min-w-0 md:sticky md:top-6 md:self-start">
          <GameCover
            title={game.title}
            thumbUrl={game.coverUrl ?? game.coverThumbUrl}
            priority
          />
        </div>

        <div className="min-w-0 space-y-6">
          <section aria-labelledby="record-heading">
            <h2 id="record-heading" className="sr-only">
              Record
            </h2>
            <dl className="rounded-xl border border-edge bg-shelf/40 px-4">
              <DataRow label="Platform" value={game.platform.name} />
              <DataRow label="Edition" value={game.edition} />
              <DataRow
                label="Release year"
                value={game.releaseYear}
                edited={edited.has('releaseYear')}
              />
              <DataRow
                label="Publisher"
                value={game.publisher}
                edited={edited.has('publisher')}
              />
              <DataRow
                label="Genre"
                value={game.genre}
                edited={edited.has('genre')}
              />
              <DataRow
                label="Players"
                value={game.playerCount}
                edited={edited.has('playerCount')}
              />
              <DataRow label="Copies" value={game.copyCount} />
              <DataRow label="Platform ID" value={game.platformId} />
              <DataRow label="External ID" value={game.externalId} />
              <DataRow label="Source" value={sourceLabel(game.source)} />
              <DataRow label="Added" value={formatDateTime(game.createdAt)} />
              <DataRow label="Updated" value={formatDateTime(game.updatedAt)} />
              <DataRow label="Record ID" value={game.id} />
            </dl>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <GameEditForm game={game} platforms={platforms} />
            <ReEnrichControl gameId={game.id} title={game.title} />
            <div className="ml-auto">
              <DeleteGameButton gameId={game.id} title={game.title} />
            </div>
          </div>

          <details className="rounded-xl border border-edge bg-shelf/40">
            <summary className="cursor-pointer px-4 py-3 text-sm text-muted select-none">
              Raw metadata (archival)
            </summary>
            <pre className="max-h-96 overflow-auto border-t border-edge px-4 py-3 font-mono text-xs break-words whitespace-pre-wrap text-muted">
              {prettyRaw(game.rawMetadata)}
            </pre>
          </details>
        </div>
      </div>
    </article>
  );
}
