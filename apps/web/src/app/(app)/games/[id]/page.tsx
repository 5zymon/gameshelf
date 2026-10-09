import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { getGame, getPlatforms } from '@/lib/api/server';
import { GameDetailView } from '@/components/game-detail-view';

export const dynamic = 'force-dynamic';

/** Postgres `Int` upper bound; larger ids cannot exist and must 404, not 500. */
const MAX_GAME_ID = 2147483647;

function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= MAX_GAME_ID ? value : null;
}

export default async function GameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  await requireUser();
  const { id } = await params;
  const gameId = parseId(id);
  if (gameId === null || gameId < 1) notFound();
  const [game, platforms] = await Promise.all([
    getGame(gameId),
    getPlatforms(),
  ]);
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
