import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function NotFound(): Promise<React.ReactElement> {
  const t = await getTranslations('common');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-xs uppercase tracking-widest text-accent">404</p>
      <h1 className="text-2xl font-semibold tracking-tight text-fog">
        {t('notFoundTitle')}
      </h1>
      <p className="text-sm text-muted">
        {t('notFoundBody')}{' '}
        <Link className="text-accent hover:text-accent-strong" href="/">
          {t('backToCatalog')}
        </Link>
      </p>
    </main>
  );
}
