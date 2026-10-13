import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { getGame, getPlatforms } from '@/lib/api/server';
import { isUuidV7 } from '@/lib/uuid';
import { GameDetailView } from '@/components/game-detail-view';

export const dynamic = 'force-dynamic';

export default async function GameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  await requireUser();
  const { id } = await params;
  // A malformed id cannot exist, so it is a 404 page (the API would 400 it).
  if (!isUuidV7(id)) notFound();
  const [game, platforms] = await Promise.all([getGame(id), getPlatforms()]);
  if (game === null) notFound();
  const t = await getTranslations('common');
  return (
    <section className="space-y-6">
      <Link
        href="/"
        className="text-sm text-accent-text underline-offset-4 hover:underline"
      >
        ← {t('backToCatalog')}
      </Link>
      <GameDetailView game={game} platforms={platforms} />
    </section>
  );
}
