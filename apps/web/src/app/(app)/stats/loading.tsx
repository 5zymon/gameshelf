import { getTranslations } from 'next-intl/server';
import { SkeletonBlock } from '@/components/skeletons';

export default async function Loading(): Promise<React.ReactElement> {
  const t = await getTranslations('loading');
  return (
    <section
      className="animate-pulse space-y-6 motion-reduce:animate-none"
      aria-busy="true"
    >
      <span className="sr-only">{t('stats')}</span>
      <header className="space-y-1">
        <SkeletonBlock className="h-8 w-48" />
        <SkeletonBlock className="h-4 w-64" />
      </header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-card border border-edge bg-surface p-6">
          <SkeletonBlock className="h-4 w-20" />
          <SkeletonBlock className="mt-2 h-8 w-24" />
        </div>
      </div>
      <div className="rounded-card border border-edge bg-surface p-6 sm:p-8">
        <SkeletonBlock className="h-5 w-40" />
        <SkeletonBlock className="mt-4 h-2 w-full" />
        <SkeletonBlock className="mt-4 h-2 w-3/4" />
        <SkeletonBlock className="mt-4 h-2 w-1/2" />
      </div>
    </section>
  );
}
