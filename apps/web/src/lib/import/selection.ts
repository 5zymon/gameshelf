import type { TranslatorFor } from '@/i18n/translate';

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
  t: TranslatorFor<'import'>,
): { ok: true; kind: PhotoKind } | { ok: false; reason: string } {
  const ext = fileExtension(file.name);
  const mime = file.type.toLowerCase();
  if (HEIC_EXT.has(ext) || HEIC_MIME.has(mime))
    return { ok: true, kind: 'heic' };
  if (RASTER_EXT.has(ext) || RASTER_MIME.has(mime)) {
    return { ok: true, kind: 'raster' };
  }
  return { ok: false, reason: t('rejections.unsupported') };
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

/**
 * Extracts the image files from a paste event's clipboard so a pasted
 * screenshot flows through the same intake as a dropped file. `files` is the
 * primary source; `items` + `getAsFile()` is the fallback for browsers that
 * only populate the item list. Returns `[]` when the clipboard holds no
 * image, so the caller can let a plain-text paste through untouched.
 */
export function extractImageFiles(clipboardData: DataTransfer): File[] {
  const files = Array.from(clipboardData.files).filter((file) =>
    file.type.startsWith('image/'),
  );
  if (files.length > 0) return files;
  const fromItems: File[] = [];
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file !== null) fromItems.push(file);
  }
  return fromItems;
}

export interface IntakeResult {
  accepted: { file: File; kind: PhotoKind }[];
  rejections: { name: string; reason: string }[];
}

/** Enforces per-file size and the 50-photo ceiling; over-limit files are rejected, not dropped silently. */
export function validateIntake(
  existingCount: number,
  incoming: readonly File[],
  t: TranslatorFor<'import'>,
  locale: string,
): IntakeResult {
  const accepted: IntakeResult['accepted'] = [];
  const rejections: IntakeResult['rejections'] = [];
  let remaining = MAX_PHOTOS - existingCount;
  for (const file of incoming) {
    if (remaining <= 0) {
      rejections.push({
        name: file.name,
        reason: t('rejections.tooMany', { limit: MAX_PHOTOS }),
      });
      continue;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      rejections.push({
        name: file.name,
        reason: t('tooLarge', {
          size: formatBytes(file.size, locale),
          limit: formatBytes(MAX_PHOTO_BYTES, locale),
        }),
      });
      continue;
    }
    const kind = classifyFile(file, t);
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
export function declaredCountError(
  raw: string,
  t: TranslatorFor<'import'>,
): string | null {
  const value = raw.trim();
  if (value === '') return null;
  if (!/^\d+$/.test(value)) return t('countError.notNumber');
  const n = Number(value);
  return n >= 1 && n <= MAX_DECLARED_COUNT
    ? null
    : t('countError.range', { max: MAX_DECLARED_COUNT });
}

/** One entry per uploaded photo, index-aligned; '' means undeclared. */
export function buildDeclaredCounts(
  counts: readonly string[],
  t: TranslatorFor<'import'>,
): string[] {
  return counts.map((value) =>
    declaredCountError(value, t) === null ? value.trim() : '',
  );
}

/** Locale-aware size: `12,5 MB` in PL, `12.5 MB` in EN. */
export function formatBytes(bytes: number, locale: string): string {
  const mb = bytes / (1024 * 1024);
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return mb >= 1
    ? `${nf.format(mb)} MB`
    : `${nf.format(Math.max(1, Math.round(bytes / 1024)))} KB`;
}
