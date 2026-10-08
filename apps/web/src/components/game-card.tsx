import Link from 'next/link';
import type { GameListItem } from '@/lib/api';
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
  return (
    <li className="group min-w-0">
      <Link
        href={`/games/${String(game.id)}`}
        aria-label={`${game.title} — ${game.platform.name}`}
        className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <GameCover
          title={game.title}
          thumbUrl={thumbUrl}
          priority={priority}
          alt=""
        />
        <div className="mt-2 min-w-0">
          <p
            className="truncate text-sm font-medium text-fog"
            title={game.title}
          >
            {game.title}
          </p>
          <p className="truncate text-xs text-muted">{game.platform.name}</p>
        </div>
      </Link>
    </li>
  );
}
