import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function NewGamePage(): Promise<React.ReactElement> {
  await requireUser();
  return (
    <section className="space-y-2">
      <p className="text-xs uppercase tracking-widest text-accent">Add</p>
      <h1 className="text-3xl font-semibold tracking-tight">Add a game</h1>
      <p className="text-sm text-muted">
        Manual add arrives in a later ticket.
      </p>
    </section>
  );
}
