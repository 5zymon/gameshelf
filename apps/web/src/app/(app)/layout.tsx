import { redirect } from 'next/navigation';
import { LogoutButton } from '@/components/logout-button';
import { getCurrentUser } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (user === null) redirect('/login');
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-edge px-6 py-4">
        <span className="font-semibold tracking-tight text-fog">GameShelf</span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted">{user.email}</span>
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
