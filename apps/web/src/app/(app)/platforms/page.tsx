import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function PlatformsPage(): Promise<React.ReactElement> {
  await requireUser();
  return (
    <section className="space-y-2">
      <p className="text-xs uppercase tracking-widest text-accent">Platforms</p>
      <h1 className="text-3xl font-semibold tracking-tight">Platforms</h1>
      <p className="text-sm text-muted">
        Platform management arrives in a later ticket.
      </p>
    </section>
  );
}
