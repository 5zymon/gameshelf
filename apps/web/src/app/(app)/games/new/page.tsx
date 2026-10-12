import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/auth';
import { getPlatforms } from '@/lib/api/server';
import { ManualAddForm } from '@/components/manual-add-form';

export const dynamic = 'force-dynamic';

export default async function NewGamePage(): Promise<React.ReactElement> {
  await requireUser();
  const t = await getTranslations('manualAdd');
  const platforms = await getPlatforms();
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-[clamp(27px,4.5vw,34px)] leading-[1.15] font-bold tracking-[-0.02em]">
          {t('heading')}
        </h1>
        <p className="mt-1 text-[15px] text-muted">{t('subheading')}</p>
      </header>
      <ManualAddForm platforms={platforms} />
    </section>
  );
}
