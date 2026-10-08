import { fileExtension } from './selection';

export function jpegName(originalName: string): string {
  const ext = fileExtension(originalName);
  const base = ext === '' ? originalName : originalName.slice(0, -ext.length);
  return `${base}.jpg`;
}

/**
 * Converts one HEIC/HEIF file to a JPEG `File`. `libheif` applies the container
 * `irot`/`imir` transforms during decode, so the JPEG is upright without needing
 * EXIF. The `heic-to/csp` build avoids `unsafe-eval`/WASM so it works under the
 * app's strict CSP (still needs `worker-src blob:` — see middleware).
 */
export async function convertHeicToJpeg(file: File): Promise<File> {
  const { heicTo } = await import('heic-to/csp');
  const blob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 });
  if (!(blob instanceof Blob)) throw new Error('HEIC conversion failed');
  return new File([blob], jpegName(file.name), {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  });
}
