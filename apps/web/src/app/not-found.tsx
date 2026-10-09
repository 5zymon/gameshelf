import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function NotFound(): Promise<React.ReactElement> {
  const t = await getTranslations('common');
  return (
    <main className="relative mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="nocturne-glow" aria-hidden="true" />
      <div className="relative z-[1] flex flex-col gap-2">
        <p className="text-xs font-medium tracking-widest text-accent-text uppercase">
          404
        </p>
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-ink">
          {t('notFoundTitle')}
        </h1>
        <p className="text-sm text-muted">
          {t('notFoundBody')}{' '}
          <Link
            className="text-accent-text underline-offset-4 hover:underline"
            href="/"
          >
            {t('backToCatalog')}
          </Link>
        </p>
      </div>
    </main>
  );
}
