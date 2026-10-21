import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { TranslatorFor } from '@/i18n/translate';
import { getStats } from '@/lib/api/server';

export const dynamic = 'force-dynamic';

const PRIMARY_BUTTON =
  'inline-flex items-center justify-center rounded-control bg-accent px-4 py-2.5 text-sm leading-none font-semibold text-accent-ink transition-colors duration-[140ms] ease-[ease] hover:bg-accent-strong motion-reduce:transition-none disabled:opacity-60';
const SECONDARY_BUTTON =
  'inline-flex items-center justify-center rounded-control border border-edge bg-surface px-4 py-2.5 text-sm leading-none font-medium text-ink transition-colors duration-[140ms] ease-[ease] hover:border-edge-strong motion-reduce:transition-none disabled:opacity-60';

export default async function StatsPage(): Promise<React.ReactElement> {
  const stats = await getStats();
  if (stats === null) redirect('/login');
  const [t, format] = await Promise.all([
    getTranslations('stats'),
    getFormatter(),
  ]);

  const { games, copies } = stats.totals;
  if (games === 0) return <EmptyStats t={t} />;

  const { platforms, decades, noReleaseYear, dataQuality } = stats;
  const maxGames = Math.max(...platforms.map((platform) => platform.games), 1);
  const maxDecadeGames = Math.max(
    ...decades.map((decade) => decade.games),
    noReleaseYear,
    1,
  );

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-[clamp(27px,4.5vw,34px)] leading-[1.15] font-bold tracking-[-0.02em]">
          {t('title')}
        </h1>
        <p className="text-[15px] text-muted">
          {t('summary', { games, copies })}
        </p>
      </header>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-card border border-edge bg-surface p-6">
          <dt className="text-sm text-muted">{t('gamesLabel')}</dt>
          <dd className="mt-2 text-[clamp(27px,4.5vw,34px)] leading-[1.15] font-bold tracking-[-0.02em] text-ink">
            {format.number(games)}
          </dd>
        </div>
      </dl>

      <div className="rounded-card border border-edge bg-surface p-6 sm:p-8">
        <h2 id="platforms-heading" className="text-lg font-semibold text-ink">
          {t('platforms.title')}
        </h2>
        <table
          aria-labelledby="platforms-heading"
          className="mt-4 w-full text-sm"
        >
          <thead className="sr-only">
            <tr>
              <th scope="col">{t('platforms.platform')}</th>
              <th scope="col">{t('platforms.games')}</th>
            </tr>
          </thead>
          <tbody>
            {platforms.map((platform) => (
              <BarRow
                key={platform.id}
                label={platform.name}
                games={platform.games}
                max={maxGames}
                format={format}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-card border border-edge bg-surface p-6 sm:p-8">
        <h2 id="decades-heading" className="text-lg font-semibold text-ink">
          {t('decades.title')}
        </h2>
        <table
          aria-labelledby="decades-heading"
          className="mt-4 w-full text-sm"
        >
          <thead className="sr-only">
            <tr>
              <th scope="col">{t('decades.period')}</th>
              <th scope="col">{t('decades.share')}</th>
              <th scope="col">{t('decades.games')}</th>
            </tr>
          </thead>
          <tbody>
            {decades.map((decade) => (
              <BarRow
                key={decade.decade}
                label={t('decades.decade', { decade: String(decade.decade) })}
                games={decade.games}
                max={maxDecadeGames}
                format={format}
              />
            ))}
            {noReleaseYear > 0 ? (
              <BarRow
                label={t('decades.noYear')}
                games={noReleaseYear}
                max={maxDecadeGames}
                format={format}
              />
            ) : null}
          </tbody>
        </table>
      </div>

      {dataQuality.unverifiedPlatform > 0 ? (
        <div className="rounded-card border border-edge bg-surface p-6 sm:p-8">
          <h2 className="text-lg font-semibold text-ink">
            {t('dataQuality.title')}
          </h2>
          <p className="mt-2 text-sm text-ink">
            {t('dataQuality.unverifiedPlatform', {
              count: dataQuality.unverifiedPlatform,
            })}
          </p>
          <p className="mt-1 text-sm text-muted">
            {t('dataQuality.unverifiedNote', {
              count: dataQuality.unverifiedPlatform,
            })}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function BarRow({
  label,
  games,
  max,
  format,
}: {
  label: string;
  games: number;
  max: number;
  format: Awaited<ReturnType<typeof getFormatter>>;
}): React.ReactElement {
  return (
    <tr>
      <th
        scope="row"
        className="max-w-40 py-2 pr-4 text-left font-medium whitespace-nowrap text-ink"
      >
        {label}
      </th>
      <td role="presentation" className="w-full py-2 pr-4">
        <svg
          aria-hidden="true"
          focusable="false"
          className="block h-2 w-full"
          viewBox="0 0 100 8"
          preserveAspectRatio="none"
        >
          <rect width="100" height="8" rx="2" className="fill-edge" />
          <rect
            width={(games / max) * 100}
            height="8"
            rx="2"
            className="fill-accent"
          />
        </svg>
      </td>
      <td className="py-2 text-right text-ink tabular-nums">
        {format.number(games)}
      </td>
    </tr>
  );
}

function EmptyStats({ t }: { t: TranslatorFor<'stats'> }): React.ReactElement {
  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-[clamp(27px,4.5vw,34px)] leading-[1.15] font-bold tracking-[-0.02em]">
          {t('title')}
        </h1>
      </header>
      <div className="rounded-card border border-edge bg-surface p-6 sm:p-8">
        <h2 className="text-lg font-semibold text-ink">{t('empty.title')}</h2>
        <p className="mt-2 max-w-md text-sm text-muted">{t('empty.body')}</p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link href="/import" className={PRIMARY_BUTTON}>
            {t('empty.import')}
          </Link>
          <Link href="/games/new" className={SECONDARY_BUTTON}>
            {t('empty.addGame')}
          </Link>
        </div>
      </div>
    </section>
  );
}
