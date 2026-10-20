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
    </section>
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
