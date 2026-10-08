import { requireUser } from '@/lib/auth';
import { getPlatforms } from '@/lib/api/server';
import { ManualAddForm } from '@/components/manual-add-form';

export const dynamic = 'force-dynamic';

export default async function NewGamePage(): Promise<React.ReactElement> {
  await requireUser();
  const platforms = await getPlatforms();
  return (
    <section className="space-y-6">
      <header>
        <p className="text-xs tracking-widest text-accent uppercase">Add</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Add a game
        </h1>
        <p className="mt-1 text-sm text-muted">
          Enter a game by hand. Records added here aren’t linked to a game
          database.
        </p>
      </header>
      <ManualAddForm platforms={platforms} />
    </section>
  );
}
