import { requireUser } from '@/lib/auth';
import { getPlatforms } from '@/lib/api/server';
import { PlatformsManager } from '@/components/platforms-manager';

export const dynamic = 'force-dynamic';

export default async function PlatformsPage(): Promise<React.ReactElement> {
  await requireUser();
  const platforms = await getPlatforms();
  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Platforms
        </h1>
        <p className="text-sm text-muted">
          The canonical list every import matches against. Rename keeps the old
          name as an alias; merge moves games and keeps the merged name
          matchable.
        </p>
      </header>
      <PlatformsManager platforms={platforms} />
    </section>
  );
}
