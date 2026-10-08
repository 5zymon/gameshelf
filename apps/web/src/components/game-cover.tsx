'use client';

import { useEffect, useRef, useState } from 'react';

type LoadState = 'loading' | 'loaded' | 'error';

const FRAME =
  'relative aspect-[3/4] w-full overflow-hidden rounded-lg border border-edge bg-shelf transition-colors group-hover:border-accent/70 motion-reduce:transition-none';

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
  /**
   * Descriptive alt for standalone use (detail hero, re-enrich preview). Tiles
   * pass `""` because the surrounding link already names the game, so the image
   * is decorative and would otherwise be announced twice.
   */
  alt?: string;
}

/**
 * Client cover with a fixed `aspect-[3/4]` frame and a title placeholder on a
 * missing/errored source. The `<img>` is visible from first paint (the pulse is
 * only a contrasting underlay behind the transparent, not-yet-decoded image),
 * so priority covers can render before hydration and with no JS. A 500ms fade
 * is applied only to images that finish loading *after* mount; an image already
 * complete at hydration snaps straight to full opacity.
 */
export function GameCover({
  title,
  thumbUrl,
  priority = false,
  alt,
}: GameCoverProps): React.ReactElement {
  const src = sameOriginPath(thumbUrl);
  const [state, setState] = useState<LoadState>('loading');
  // False until we know the image was still loading when React attached; only
  // then is a fade warranted. Keeps SSR/first paint at full opacity (LCP).
  const [animate, setAnimate] = useState(false);
  // A mounted instance can outlive its first `src`: on the detail page a
  // successful re-enrich + router.refresh() updates `thumbUrl` in place. Once
  // `state` is `error` the `<img>` is unmounted, so the `[src]` effect below
  // never runs and the placeholder would otherwise persist forever. Reset the
  // load state during render (before that effect's `img.complete` check) so the
  // new source gets its own load/error verdict.
  const [prevSrc, setPrevSrc] = useState(src);
  if (src !== prevSrc) {
    setPrevSrc(src);
    setState('loading');
    setAnimate(false);
  }
  const imgRef = useRef<HTMLImageElement>(null);

  // onLoad does not fire for an image already complete at hydration time.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete) {
      setState(img.naturalWidth > 0 ? 'loaded' : 'error');
    } else {
      setAnimate(true);
    }
  }, [src]);

  if (src === null || state === 'error') {
    return (
      <div
        className={`${FRAME} flex flex-col items-center justify-center gap-3 p-3 text-center`}
        aria-hidden="true"
      >
        <span className="h-0.5 w-8 bg-accent/70" />
        <span className="line-clamp-4 text-sm font-medium text-muted">
          {title}
        </span>
      </div>
    );
  }
  const visible = state === 'loaded' || !animate;
  return (
    <div className={FRAME}>
      {state === 'loading' && (
        <span
          aria-hidden
          className="absolute inset-0 animate-pulse bg-edge/60 motion-reduce:animate-none"
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- the API already serves a same-origin 300px WebP thumbnail; next/image would re-optimise it and add a /_next/image hop behind SessionGuard */}
      <img
        ref={imgRef}
        src={src}
        alt={alt ?? `${title} cover art`}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        onLoad={() => {
          setState('loaded');
        }}
        onError={() => {
          setState('error');
        }}
        className={`relative h-full w-full object-cover ${
          animate
            ? 'transition-opacity duration-500 motion-reduce:transition-none'
            : ''
        } ${visible ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
}
