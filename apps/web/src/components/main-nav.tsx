'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: 'Catalog' },
  { href: '/platforms', label: 'Platforms' },
  { href: '/import', label: 'Import' },
  { href: '/settings', label: 'Settings' },
] as const;

const GAME_DETAIL = /^\/games\/\d+(?:\/|$)/;

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/' || GAME_DETAIL.test(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MainNav(): React.ReactElement {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="flex flex-wrap items-center gap-1 text-sm"
    >
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-md px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              active
                ? 'bg-shelf text-fog'
                : 'text-muted hover:bg-shelf hover:text-fog'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
