import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

interface CatalogPaginationProps {
  page: number;
  totalPages: number;
  prevHref: string | null;
  nextHref: string | null;
}

const LINK =
  'rounded-md border border-edge px-3 py-1.5 text-sm text-fog hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const DISABLED =
  'rounded-md border border-edge px-3 py-1.5 text-sm text-muted opacity-40';

export async function CatalogPagination({
  page,
  totalPages,
  prevHref,
  nextHref,
}: CatalogPaginationProps): Promise<React.ReactElement | null> {
  if (totalPages <= 1) return null;
  const t = await getTranslations('pagination');
  return (
    <nav
      aria-label={t('ariaLabel')}
      className="flex items-center justify-between gap-4"
    >
      {prevHref === null ? (
        <span aria-disabled="true" className={DISABLED}>
          {t('previous')}
        </span>
      ) : (
        <Link href={prevHref} rel="prev" className={LINK}>
          {t('previous')}
        </Link>
      )}
      <p className="text-sm text-muted">{t('pageOf', { page, totalPages })}</p>
      {nextHref === null ? (
        <span aria-disabled="true" className={DISABLED}>
          {t('next')}
        </span>
      ) : (
        <Link href={nextHref} rel="next" className={LINK}>
          {t('next')}
        </Link>
      )}
    </nav>
  );
}
