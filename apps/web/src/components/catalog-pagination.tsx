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

export function CatalogPagination({
  page,
  totalPages,
  prevHref,
  nextHref,
}: CatalogPaginationProps): React.ReactElement | null {
  if (totalPages <= 1) return null;
  return (
    <nav
      aria-label="Catalog pages"
      className="flex items-center justify-between gap-4"
    >
      {prevHref === null ? (
        <span aria-disabled="true" className={DISABLED}>
          Previous
        </span>
      ) : (
        <Link href={prevHref} rel="prev" className={LINK}>
          Previous
        </Link>
      )}
      <p className="text-sm text-muted">
        Page {page} of {totalPages}
      </p>
      {nextHref === null ? (
        <span aria-disabled="true" className={DISABLED}>
          Next
        </span>
      ) : (
        <Link href={nextHref} rel="next" className={LINK}>
          Next
        </Link>
      )}
    </nav>
  );
}
