import Link from 'next/link';
import type { GameListItem } from '@/lib/api';
import { formatRating } from '@/lib/rating';
import { GameCover } from './game-cover';

interface GameCardProps {
  game: GameListItem;
  priority?: boolean;
}

export function GameCard({
  game,
  priority = false,
}: GameCardProps): React.ReactElement {
  const thumbUrl = game.coverThumbUrl ?? game.coverUrl; // defensive full-cover fallback; both same-origin
  const rating = formatRating(game.rating);
  return (
    <li className="group min-w-0">
      <Link
        href={`/games/${String(game.id)}`}
        aria-label={`${game.title} — ${game.platform.name}${rating === null ? '' : ` — ${rating}`}`}
        className="block overflow-hidden rounded-card border border-edge bg-surface shadow-[var(--shadow-card)] transition-[transform,box-shadow,border-color] duration-[160ms] ease-[ease] motion-reduce:transition-none motion-safe:hover:-translate-y-1 hover:border-accent-soft hover:shadow-[var(--shadow-card-hover)]"
      >
        <div className="relative">
          <GameCover
            title={game.title}
            thumbUrl={thumbUrl}
            priority={priority}
            alt=""
          />
          {rating !== null && (
            <span className="absolute top-2 right-2 rounded-full border border-edge bg-surface/90 px-2 py-0.5 text-[11px] leading-[1.4] font-semibold tabular-nums text-ink shadow-[var(--shadow-card)] backdrop-blur-sm">
              {rating}
            </span>
          )}
        </div>
        <div className="px-3.5 pt-3 pb-3.5 min-w-0">
          <p
            className="truncate font-display text-[15px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink"
            title={game.title}
          >
            {game.title}
          </p>
          <p className="truncate text-xs leading-[1.45] text-muted">
            {game.platform.name}
          </p>
        </div>
      </Link>
    </li>
  );
}
