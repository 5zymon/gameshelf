import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function SettingsPage(): Promise<React.ReactElement> {
  await requireUser();
  return (
    <section className="space-y-2">
      <p className="text-xs uppercase tracking-widest text-accent">Settings</p>
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
      <p className="text-sm text-muted">Settings arrive in a later ticket.</p>
    </section>
  );
}
