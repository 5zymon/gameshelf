import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/auth';
import { getPlatforms } from '@/lib/api/server';
import { PlatformsManager } from '@/components/platforms-manager';

export const dynamic = 'force-dynamic';

export default async function PlatformsPage(): Promise<React.ReactElement> {
  await requireUser();
  const t = await getTranslations('platforms');
  const platforms = await getPlatforms();
  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('title')}
        </h1>
        <p className="text-sm text-muted">{t('subtitle')}</p>
      </header>
      <PlatformsManager platforms={platforms} />
    </section>
  );
}
