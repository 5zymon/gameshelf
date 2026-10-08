'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** `key` maps each route to its `nav` message key (labels are translated). */
const NAV_ITEMS = [
  { href: '/', key: 'catalog' },
  { href: '/platforms', key: 'platforms' },
  { href: '/import', key: 'import' },
  { href: '/settings', key: 'settings' },
] as const;

const GAME_DETAIL = /^\/games\/\d+(?:\/|$)/;

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/' || GAME_DETAIL.test(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MainNav(): React.ReactElement {
  const pathname = usePathname();
  const t = useTranslations('nav');
  return (
    <nav
      aria-label={t('main')}
      className="order-5 -mx-1 flex w-full items-center gap-0.5 overflow-x-auto px-1 md:order-none md:mx-0 md:w-auto md:overflow-visible md:px-0"
    >
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-full px-3 py-2 whitespace-nowrap text-sm font-medium transition-colors duration-[140ms] ease-[ease] motion-reduce:transition-none ${
              active
                ? 'bg-accent-soft text-accent-text'
                : 'text-muted hover:bg-ink/5 hover:text-ink'
            }`}
          >
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
