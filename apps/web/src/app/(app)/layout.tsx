import Link from 'next/link';
import { LogoutButton } from '@/components/logout-button';
import { MainNav } from '@/components/main-nav';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const user = await requireUser();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-edge">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-3 px-6 py-4">
          <Link
            href="/"
            className="font-semibold tracking-tight text-fog focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            GameShelf
          </Link>
          <MainNav />
          <div className="ml-auto flex items-center gap-4">
            <span className="text-sm text-muted">{user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
