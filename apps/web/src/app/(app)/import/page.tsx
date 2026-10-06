import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function ImportPage(): Promise<React.ReactElement> {
  await requireUser();
  return (
    <section className="space-y-2">
      <p className="text-xs uppercase tracking-widest text-accent">Import</p>
      <h1 className="text-3xl font-semibold tracking-tight">Import</h1>
      <p className="text-sm text-muted">
        Import tools arrive in a later ticket.
      </p>
    </section>
  );
}
