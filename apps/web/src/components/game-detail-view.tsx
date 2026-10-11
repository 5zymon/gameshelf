import { Fragment } from 'react';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { TranslatorFor } from '@/i18n/translate';
import type { GameDetail, GamePlatform } from '@/lib/api';
import { formatRating } from '@/lib/rating';
import { DeleteGameButton } from './delete-game-button';
import { GameCover } from './game-cover';
import { GameGallery } from './game-gallery';
import { GameEditForm } from './game-edit-form';
import { GameVideos } from './game-videos';
import { ReEnrichControl } from './re-enrich-control';

function sourceLabel(
  source: GameDetail['source'],
  t: TranslatorFor<'gameDetail'>,
): string {
  return source === 'MANUAL' ? t('source.manual') : source;
}

/** Pretty-prints the archival `rawMetadata`; falls back to the raw text. */
function prettyRaw(raw: string | null, t: TranslatorFor<'gameDetail'>): string {
  if (raw === null) return t('noRawMetadata');
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
      ? 'text-danger'
      : tone === 'muted'
        ? 'text-muted'
        : 'text-ink';
  const dotClass =
    tone === 'danger'
      ? 'bg-danger'
      : tone === 'muted'
        ? 'bg-edge'
        : 'bg-accent';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface px-2.5 py-1 text-xs ${toneClass}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {children}
    </span>
  );
}

function DataRow({
  label,
  value,
  edited = false,
  notSet,
  handEdited,
}: {
  label: string;
  value: string | number | null;
  edited?: boolean;
  notSet: string;
  handEdited: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5 border-b border-edge-soft py-2 last:border-b-0">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="text-sm text-ink">
        {value === null || value === '' ? (
          <span className="text-muted">{notSet}</span>
        ) : (
          String(value)
        )}
        {edited && (
          <span className="ml-2 text-xs text-muted">{handEdited}</span>
        )}
      </dd>
    </div>
  );
}

export async function GameDetailView({
  game,
  platforms,
}: {
  game: GameDetail;
  platforms: GamePlatform[];
}): Promise<React.ReactElement> {
  const t = await getTranslations('gameDetail');
  const format = await getFormatter();
  const edited = new Set(game.userEditedFields);
  const notSet = t('notSet');
  const handEdited = t('handEdited');

  /** Deterministic UTC rendering so server and client text never disagree. */
  const formatDateTime = (value: string | null): string => {
    if (value === null) return t('never');
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? t('unknown')
      : format.dateTime(date, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'UTC',
        });
  };

  const metaParts = [
    game.platform.name,
    game.edition,
    game.releaseYear === null ? null : String(game.releaseYear),
  ].filter((part): part is string => part !== null && part !== '');

  return (
    <article className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-[clamp(27px,4.5vw,34px)] leading-[1.15] font-bold tracking-[-0.02em]">
            {game.title}
          </h1>
          {metaParts.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              {metaParts.map((part, index) => (
                <Fragment key={`${String(index)}-${part}`}>
                  {index > 0 && (
                    <span aria-hidden className="h-3 w-px bg-edge" />
                  )}
                  <span className={index === 0 ? 'text-ink' : undefined}>
                    {part}
                  </span>
                </Fragment>
              ))}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip>
            {t('field.source')}: {sourceLabel(game.source, t)}
          </Chip>
          {game.igdbUrl !== null && (
            <a
              href={game.igdbUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Chip>{t('viewOnIgdb')}</Chip>
            </a>
          )}
          <Chip tone="muted">
            {game.enrichedAt === null
              ? t('neverEnriched')
              : t('lastEnriched', { date: formatDateTime(game.enrichedAt) })}
          </Chip>
          {game.platformUnverified && (
            <Chip tone="danger">{t('platformUnverified')}</Chip>
          )}
          {game.externalId === null && (
            <Chip tone="muted">{t('notLinked')}</Chip>
          )}
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
        <div className="min-w-0 max-w-[10rem] sm:max-w-[12rem] md:sticky md:top-6 md:max-w-none md:self-start">
          <div className="overflow-hidden rounded-card border border-edge bg-surface shadow-[var(--shadow-card)]">
            <GameCover
              title={game.title}
              thumbUrl={game.coverUrl ?? game.coverThumbUrl}
              priority
              alt={t('coverAlt', { title: game.title })}
            />
          </div>
        </div>

        <div className="min-w-0 space-y-6">
          <section aria-labelledby="record-heading">
            <h2 id="record-heading" className="sr-only">
              {t('record')}
            </h2>
            <dl className="grid gap-x-8 sm:grid-cols-2">
              <DataRow
                label={t('field.platform')}
                value={game.platform.name}
                notSet={notSet}
                handEdited={handEdited}
              />
              <DataRow
                label={t('field.edition')}
                value={game.edition}
                notSet={notSet}
                handEdited={handEdited}
              />
              <DataRow
                label={t('field.releaseYear')}
                value={game.releaseYear}
                edited={edited.has('releaseYear')}
                notSet={notSet}
                handEdited={handEdited}
              />
              <DataRow
                label={t('field.publisher')}
                value={game.publisher}
                edited={edited.has('publisher')}
                notSet={notSet}
                handEdited={handEdited}
              />
              <DataRow
                label={t('field.genre')}
                value={game.genre}
                edited={edited.has('genre')}
                notSet={notSet}
                handEdited={handEdited}
              />
              <DataRow
                label={t('field.players')}
                value={game.playerCount}
                edited={edited.has('playerCount')}
                notSet={notSet}
                handEdited={handEdited}
              />
              <DataRow
                label={t('field.rating')}
                value={formatRating(game.rating)}
                notSet={notSet}
                handEdited={handEdited}
              />
              <DataRow
                label={t('field.copies')}
                value={game.copyCount}
                notSet={notSet}
                handEdited={handEdited}
              />
              <DataRow
                label={t('field.platformId')}
                value={game.platformId}
                notSet={notSet}
                handEdited={handEdited}
              />
              <DataRow
                label={t('field.externalId')}
                value={game.externalId}
                notSet={notSet}
                handEdited={handEdited}
              />
              <DataRow
                label={t('field.source')}
                value={sourceLabel(game.source, t)}
                notSet={notSet}
                handEdited={handEdited}
              />
              <DataRow
                label={t('field.added')}
                value={formatDateTime(game.createdAt)}
                notSet={notSet}
                handEdited={handEdited}
              />
              <DataRow
                label={t('field.updated')}
                value={formatDateTime(game.updatedAt)}
                notSet={notSet}
                handEdited={handEdited}
              />
              <DataRow
                label={t('field.recordId')}
                value={game.id}
                notSet={notSet}
                handEdited={handEdited}
              />
            </dl>
          </section>

          {game.summary !== null && game.summary.trim() !== '' && (
            <section aria-labelledby="summary-heading" className="space-y-2">
              <h2
                id="summary-heading"
                className="text-lg font-semibold text-ink"
              >
                {t('summary')}
                {edited.has('summary') && (
                  <span className="ml-2 text-xs font-normal text-muted">
                    {handEdited}
                  </span>
                )}
              </h2>
              <p className="max-w-prose text-sm leading-relaxed whitespace-pre-line text-ink">
                {game.summary}
              </p>
            </section>
          )}

          <div className="flex flex-wrap items-start gap-3">
            <GameEditForm game={game} platforms={platforms} />
            <ReEnrichControl gameId={game.id} title={game.title} />
            <div className="ml-auto">
              <DeleteGameButton gameId={game.id} title={game.title} />
            </div>
          </div>

          <details className="rounded-card border border-edge bg-surface">
            <summary className="cursor-pointer px-4 py-3 text-sm text-muted select-none">
              {t('rawMetadata')}
            </summary>
            <pre className="max-h-96 overflow-auto border-t border-edge px-4 py-3 font-mono text-xs break-words whitespace-pre-wrap text-muted">
              {prettyRaw(game.rawMetadata, t)}
            </pre>
          </details>
        </div>
      </div>

      <GameVideos title={game.title} videos={game.videos} />
      <GameGallery title={game.title} images={game.images} />
    </article>
  );
}
