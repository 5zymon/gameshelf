const FRAME =
  'aspect-[3/4] w-full overflow-hidden rounded-lg border border-edge';

/** Same-origin only: a cover must be a root-relative path, never an external URL. CSP sets img-src 'self'. */
function sameOriginPath(url: string | null): string | null {
  return url !== null && url.startsWith('/') && !url.startsWith('//')
    ? url
    : null;
}

interface GameCoverProps {
  title: string;
  thumbUrl: string | null;
  priority?: boolean;
}

export function GameCover({
  title,
  thumbUrl,
  priority = false,
}: GameCoverProps): React.ReactElement {
  const src = sameOriginPath(thumbUrl);
  if (src === null) {
    return (
      <div
        className={`${FRAME} flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-shelf to-ink p-3 text-center`}
        aria-hidden="true"
      >
        <span className="h-px w-6 bg-accent/60" />
        <span className="line-clamp-4 text-sm font-medium text-muted">
          {title}
        </span>
      </div>
    );
  }
  return (
    <div className={FRAME}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the API already serves a same-origin 300px WebP thumbnail; next/image would re-optimise it and add a /_next/image hop behind SessionGuard */}
      <img
        src={src}
        alt=""
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        className="h-full w-full object-cover"
      />
    </div>
  );
}
