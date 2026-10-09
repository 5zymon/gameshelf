import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

interface CatalogPaginationProps {
  page: number;
  totalPages: number;
  prevHref: string | null;
  nextHref: string | null;
}

const LINK =
  'inline-flex h-[38px] min-w-[38px] items-center justify-center rounded-control border border-edge px-3.5 text-sm font-medium text-ink transition-colors duration-[140ms] ease-[ease] hover:bg-surface-2 motion-reduce:transition-none';
const DISABLED =
  'inline-flex h-[38px] min-w-[38px] items-center justify-center rounded-control border border-transparent px-3.5 text-sm text-muted opacity-40';

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
      className="flex items-center justify-center gap-4"
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
