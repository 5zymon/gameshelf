'use client';

import { useEffect, useRef, useState } from 'react';
import { sameOriginPath } from '@/lib/image-url';

type LoadState = 'loading' | 'loaded' | 'error';

const FRAME = 'relative aspect-[3/4] w-full overflow-hidden bg-surface-2';

const COVER_TONES = [
  'cover-tone-1',
  'cover-tone-2',
  'cover-tone-3',
  'cover-tone-4',
  'cover-tone-5',
  'cover-tone-6',
  'cover-tone-7',
  'cover-tone-8',
  'cover-tone-9',
  'cover-tone-10',
  'cover-tone-11',
  'cover-tone-12',
] as const;

/** Deterministic per-title tone so a given game keeps the same placeholder gradient. */
function coverTone(title: string): string {
  let hash = 0;
  for (const char of title) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return COVER_TONES[hash % COVER_TONES.length] ?? 'cover-tone-1';
}

interface GameCoverProps {
  title: string;
  thumbUrl: string | null;
  priority?: boolean;
  /**
   * Alt text, decided by the caller: a translated description (e.g. the
   * `gameDetail.coverAlt` message) for standalone use, or `""` for tiles,
   * where the surrounding link already names the game and the image is
   * decorative.
   */
  alt: string;
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
    const initial = (title.trim().charAt(0) || '?').toUpperCase();
    return (
      <div
        className={`${FRAME} cover-placeholder ${coverTone(title)}`}
        aria-hidden="true"
      >
        <span className="cover-initial">{initial}</span>
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
        alt={alt}
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
