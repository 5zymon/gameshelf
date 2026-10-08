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
    <section className="mx-auto w-full max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-[clamp(27px,4.5vw,34px)] leading-[1.15] font-bold tracking-[-0.02em]">
          {t('title')}
        </h1>
        <p className="text-[15px] text-muted">{t('subtitle')}</p>
      </header>
      <PlatformsManager platforms={platforms} />
    </section>
  );
}
