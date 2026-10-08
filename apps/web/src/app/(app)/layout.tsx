import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { LogoutButton } from '@/components/logout-button';
import { MainNav } from '@/components/main-nav';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const PRIMARY_BUTTON =
  'inline-flex items-center justify-center rounded-control bg-accent px-4 py-2.5 text-sm leading-none font-semibold text-accent-ink transition-colors duration-[140ms] ease-[ease] hover:bg-accent-strong motion-reduce:transition-none disabled:opacity-60';

function avatarInitials(email: string): string {
  const local = email.split('@')[0] ?? '';
  const initials = local
    .split(/[^a-zA-Z0-9]+/)
    .filter((segment) => segment.length > 0)
    .slice(0, 2)
    .map((segment) => segment.charAt(0).toUpperCase())
    .join('');
  return initials || local.slice(0, 2).toUpperCase();
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const user = await requireUser();
  const t = await getTranslations('nav');
  return (
    <div className="relative min-h-dvh">
      <div className="nocturne-glow" aria-hidden="true" />
      <header className="relative z-[2] border-b border-edge bg-surface">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-[18px] gap-y-1 px-4 py-2.5 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 whitespace-nowrap font-display text-[17px] font-bold tracking-[-0.01em] text-ink"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              className="h-[15px] w-[15px] flex-none text-accent-text"
            >
              <path d="M12 0c1 6.5 5.5 11 12 12-6.5 1-11 5.5-12 12-1-6.5-5.5-11-12-12C5.5 11 10 6.5 12 0Z" />
            </svg>
            GameShelf
          </Link>
          <MainNav />
          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/games/new"
              className={`${PRIMARY_BUTTON} whitespace-nowrap`}
            >
              {t('addGame')}
            </Link>
            <LogoutButton />
            <span
              role="img"
              aria-label={t('account', { email: user.email })}
              className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full border border-edge bg-surface-2 text-[11px] font-semibold text-muted"
            >
              {avatarInitials(user.email)}
            </span>
          </div>
        </div>
      </header>
      <main className="relative z-[1] mx-auto w-full max-w-[1320px] px-4 pt-[30px] pb-8 sm:px-6 sm:pt-10 sm:pb-10">
        {children}
      </main>
    </div>
  );
}
