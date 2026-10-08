export const MAX_PHOTOS = 50;
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024; // 20 MB
export const MAX_DECLARED_COUNT = 1000;

export const ACCEPT_ATTR =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';

const RASTER_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const HEIC_MIME = new Set(['image/heic', 'image/heif']);
const RASTER_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const HEIC_EXT = new Set(['.heic', '.heif']);
const RASTER_EXT_MIME: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export type PhotoKind = 'raster' | 'heic';

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

/**
 * Decides whether a file is a HEIC to convert. Never rejects on MIME alone:
 * an iPhone photo can arrive with an empty `type`, so the extension decides.
 */
export function classifyFile(
  file: File,
): { ok: true; kind: PhotoKind } | { ok: false; reason: string } {
  const ext = fileExtension(file.name);
  const mime = file.type.toLowerCase();
  if (HEIC_EXT.has(ext) || HEIC_MIME.has(mime))
    return { ok: true, kind: 'heic' };
  if (RASTER_EXT.has(ext) || RASTER_MIME.has(mime)) {
    return { ok: true, kind: 'raster' };
  }
  return {
    ok: false,
    reason: 'Unsupported file type. Use JPEG, PNG, WebP or HEIC.',
  };
}

/**
 * The API's `imageFileFilter` checks MIME **and** extension, so a raster whose
 * `File.type` is empty or unrecognised (common on drag & drop) must be re-typed
 * from its extension before upload, or the API rejects the whole batch with 400.
 * A file whose MIME is already an allowed raster MIME is returned unchanged.
 */
export function normalizeRasterMime(file: File): File {
  if (RASTER_MIME.has(file.type.toLowerCase())) return file;
  const type = RASTER_EXT_MIME[fileExtension(file.name)];
  if (type === undefined) return file;
  return new File([file], file.name, {
    type,
    lastModified: file.lastModified,
  });
}

export interface IntakeResult {
  accepted: { file: File; kind: PhotoKind }[];
  rejections: { name: string; reason: string }[];
}

/** Enforces per-file size and the 50-photo ceiling; over-limit files are rejected, not dropped silently. */
export function validateIntake(
  existingCount: number,
  incoming: readonly File[],
): IntakeResult {
  const accepted: IntakeResult['accepted'] = [];
  const rejections: IntakeResult['rejections'] = [];
  let remaining = MAX_PHOTOS - existingCount;
  for (const file of incoming) {
    if (remaining <= 0) {
      rejections.push({
        name: file.name,
        reason: `Only ${String(MAX_PHOTOS)} photos can be imported at once.`,
      });
      continue;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      rejections.push({
        name: file.name,
        reason: `Too large (${formatBytes(file.size)}). The limit is ${formatBytes(MAX_PHOTO_BYTES)}.`,
      });
      continue;
    }
    const kind = classifyFile(file);
    if (!kind.ok) {
      rejections.push({ name: file.name, reason: kind.reason });
      continue;
    }
    accepted.push({ file, kind: kind.kind });
    remaining -= 1;
  }
  return { accepted, rejections };
}

/** Validates one optional count field. '' is valid (undeclared). */
export function declaredCountError(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return null;
  if (!/^\d+$/.test(value)) return 'Enter a whole number, or leave it blank.';
  const n = Number(value);
  return n >= 1 && n <= MAX_DECLARED_COUNT
    ? null
    : `Enter a number from 1 to ${String(MAX_DECLARED_COUNT)}, or leave it blank.`;
}

/** One entry per uploaded photo, index-aligned; '' means undeclared. */
export function buildDeclaredCounts(counts: readonly string[]): string[] {
  return counts.map((value) =>
    declaredCountError(value) === null ? value.trim() : '',
  );
}

export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1
    ? `${mb.toFixed(1)} MB`
    : `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}
