'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { GameVideo } from '@/lib/api';
import {
  playableVideos,
  youtubeEmbedUrl,
  youtubeThumbnailUrl,
} from '@/lib/youtube';

interface GameVideosProps {
  title: string;
  videos: GameVideo[];
}

/**
 * One embedded YouTube player with a text-only switcher. Until the user
 * presses Play (or picks a video) the frame shows the video's YouTube
 * thumbnail behind a same-origin click-to-play facade — the thumbnail is
 * fetched from `i.ytimg.com` at render (a deliberate, scoped extension of the
 * card-9.1 YouTube exception), but no `<iframe>` is mounted until Play, so
 * YouTube is not contacted for playback before then. Hidden entirely when
 * there are no embeddable videos.
 */
export function GameVideos({
  title,
  videos,
}: GameVideosProps): React.ReactElement | null {
  const t = useTranslations('gameDetail.videos');
  const uid = useId();
  const headingId = `${uid}-heading`;
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Only embeddable (valid YouTube id) videos, in API order.
  const list = playableVideos(videos);
  if (list.length === 0) return null;

  // Clamp in case the list shrinks after a router.refresh().
  const activeIndex = Math.min(active, list.length - 1);
  const current = list[activeIndex];
  // `activeIndex` is clamped into range, but `noUncheckedIndexedAccess` still
  // types the lookup as possibly undefined; the guard keeps it total.
  if (current === undefined) return null;
  const label = (video: GameVideo, index: number): string =>
    video.name ?? t('untitled', { index: index + 1 });

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="text-lg font-semibold text-ink">
        {t('heading')}
      </h2>

      <div className="relative aspect-video w-full max-w-3xl overflow-hidden rounded-card border border-edge bg-surface-2">
        {playing ? (
          <iframe
            key={current.videoId}
            src={youtubeEmbedUrl(current.videoId, true) ?? undefined}
            title={t('playerTitle', {
              title,
              name: label(current, activeIndex),
            })}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 h-full w-full"
          />
        ) : (
          <VideoFacade
            key={current.videoId}
            videoId={current.videoId}
            label={t('play', { name: label(current, activeIndex) })}
            onPlay={() => {
              setPlaying(true);
            }}
          />
        )}
      </div>

      {list.length > 1 && (
        <nav aria-label={t('choose')}>
          <ul className="flex flex-wrap gap-2">
            {list.map((video, index) => (
              <li key={video.videoId}>
                <button
                  type="button"
                  aria-pressed={index === activeIndex}
                  onClick={() => {
                    setActive(index);
                    setPlaying(true);
                  }}
                  className={`${PILL} ${
                    index === activeIndex
                      ? 'border-accent-soft bg-accent-soft text-accent-text'
                      : 'border-edge bg-surface text-ink hover:border-accent-soft'
                  }`}
                >
                  {label(video, index)}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </section>
  );
}

const PILL =
  'rounded-full border px-3 py-1 text-xs transition-colors duration-[140ms] ease-[ease] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none';

interface VideoFacadeProps {
  videoId: string;
  /** Accessible label, already translated (`Play: <name>`). */
  label: string;
  onPlay: () => void;
}

/**
 * Click-to-play facade over the video's YouTube thumbnail. `maxresdefault.jpg`
 * is absent for some videos, so a failed load falls back once to `hqdefault.jpg`
 * (guarded so a second failure hides the `<img>` instead of looping); the
 * frame's surface background then shows through. A dark scrim keeps the glyph
 * and label legible over any thumbnail.
 */
function VideoFacade({
  videoId,
  label,
  onPlay,
}: VideoFacadeProps): React.ReactElement {
  const [quality, setQuality] = useState<'max' | 'hq'>('max');
  const [failed, setFailed] = useState(false);
  const src = youtubeThumbnailUrl(videoId, quality);

  return (
    <button
      type="button"
      onClick={onPlay}
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
    >
      {!failed && src !== null && (
        // eslint-disable-next-line @next/next/no-img-element -- YouTube's thumbnail CDN; next/image cannot optimise a host we do not proxy.
        <img
          src={src}
          alt=""
          aria-hidden="true"
          decoding="async"
          onError={() => {
            if (quality === 'max') setQuality('hq');
            else setFailed(true);
          }}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-linear-to-t from-black/65 via-black/25 to-black/40"
      />
      <PlayIcon />
      <span className="relative text-sm font-medium">{label}</span>
    </button>
  );
}

function PlayIcon(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="relative h-12 w-12"
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
