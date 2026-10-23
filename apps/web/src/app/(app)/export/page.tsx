import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { CatalogExportForm } from '@/components/catalog-export-form';
import { getPlatforms, getStats } from '@/lib/api/server';
import { exportPlatforms } from '@/lib/catalog-export';

export const dynamic = 'force-dynamic';

export default async function ExportPage(): Promise<React.ReactElement> {
  const stats = await getStats();
  if (stats === null) redirect('/login');
  const platforms = await getPlatforms();
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
        <CatalogExportForm
          platforms={exportPlatforms(platforms)}
          totalGames={stats.totals.games}
        />
      </div>
    </section>
  );
}
