/** YouTube ids are 11 chars of [A-Za-z0-9_-]; anything else is never embedded. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** True when `id` is a valid 11-char YouTube video id. */
export function isYoutubeVideoId(id: string): boolean {
  return YOUTUBE_ID.test(id);
}

/**
 * `https://www.youtube.com/embed/<id>[?autoplay=1]`; `null` for an invalid id.
 * The id is `encodeURIComponent`'d even though the regex already guarantees a
 * safe id (defense in depth).
 */
export function youtubeEmbedUrl(
  videoId: string,
  autoplay = false,
): string | null {
  if (!isYoutubeVideoId(videoId)) return null;
  const base = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
  return autoplay ? `${base}?autoplay=1` : base;
}

/**
 * `https://i.ytimg.com/vi/<id>/maxresdefault.jpg` (`hqdefault.jpg` for the `hq`
 * quality); `null` for an invalid id. `maxresdefault` does not exist for every
 * video, so callers should fall back to `hq` on an image load error.
 */
export function youtubeThumbnailUrl(
  videoId: string,
  quality: 'max' | 'hq' = 'max',
): string | null {
  if (!isYoutubeVideoId(videoId)) return null;
  const file = quality === 'hq' ? 'hqdefault.jpg' : 'maxresdefault.jpg';
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${file}`;
}

/** The videos safe to embed, in API order (invalid ids dropped). */
export function playableVideos<T extends { videoId: string }>(
  videos: readonly T[],
): T[] {
  return videos.filter((video) => isYoutubeVideoId(video.videoId));
}
