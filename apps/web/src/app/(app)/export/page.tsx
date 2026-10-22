import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getStats } from '@/lib/api/server';

export const dynamic = 'force-dynamic';

const PRIMARY_BUTTON =
  'inline-flex items-center justify-center rounded-control bg-accent px-4 py-2.5 text-sm leading-none font-semibold text-accent-ink transition-colors duration-[140ms] ease-[ease] hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none';

export default async function ExportPage(): Promise<React.ReactElement> {
  const stats = await getStats();
  if (stats === null) redirect('/login');
  const t = await getTranslations('catalogExport');

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-[clamp(27px,4.5vw,34px)] leading-[1.15] font-bold tracking-[-0.02em]">
          {t('title')}
        </h1>
        <p className="text-[15px] text-muted">{t('description')}</p>
      </header>

      <div className="rounded-card border border-edge bg-surface p-6 sm:p-8">
        <fieldset>
          <legend className="text-lg font-semibold text-ink">
            {t('range')}
          </legend>
          <label className="mt-3 flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="range"
              value="all"
              defaultChecked
              className="accent-accent"
            />
            {t('wholeCatalog')}
          </label>
        </fieldset>
        {stats.totals.games === 0 ? (
          <p className="mt-4 max-w-md text-sm text-muted">{t('empty')}</p>
        ) : null}
        <div className="mt-6">
          <a href="/api/export/csv" download className={PRIMARY_BUTTON}>
            {t('download')}
          </a>
        </div>
      </div>
    </section>
  );
}
