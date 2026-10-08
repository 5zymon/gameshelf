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
        <p className="text-xs tracking-widest text-accent uppercase">
          {t('eyebrow')}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('heading')}
        </h1>
        <p className="mt-1 text-sm text-muted">{t('subheading')}</p>
      </header>
      <ManualAddForm platforms={platforms} />
    </section>
  );
}
