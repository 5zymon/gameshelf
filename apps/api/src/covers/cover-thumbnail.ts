import sharp from 'sharp';
import { COVER_THUMBNAIL_WIDTH } from './covers.options';

/**
 * Renders a catalog thumbnail (WebP, width-bounded, never enlarged) from the
 * stored cover bytes. Pure and best-effort: undecodable/invalid input resolves
 * to `null` so a broken cover can never fail an import or a sweep.
 */
export async function makeThumbnail(
  buffer: Buffer,
  width = COVER_THUMBNAIL_WIDTH,
): Promise<Buffer | null> {
  try {
    return await sharp(buffer)
      .rotate()
      .resize({ width, withoutEnlargement: true, fit: 'inside' })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    return null;
  }
}
