import { redirect } from 'next/navigation';
import { getGames } from '@/lib/api/server';

export const dynamic = 'force-dynamic';

export default async function CatalogPage(): Promise<React.ReactElement> {
  const games = await getGames();
  if (games === null) redirect('/login');
  const { items } = games;
  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-widest text-accent">Catalog</p>
        <h1 className="text-3xl font-semibold tracking-tight">Your shelf</h1>
        <p className="mt-1 text-sm text-muted">
          Showing {items.length} game{items.length === 1 ? '' : 's'}
        </p>
      </div>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-edge p-10 text-center text-muted">
          No games yet.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((game) => (
            <li
              key={game.id}
              className="rounded-xl border border-edge bg-shelf p-4"
            >
              <p className="font-medium text-fog">{game.title}</p>
              <p className="text-sm text-muted">{game.platform.name}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
