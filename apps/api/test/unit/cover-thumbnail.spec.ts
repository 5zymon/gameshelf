import sharp from 'sharp';
import { makeThumbnail } from '../../src/covers/cover-thumbnail';

async function png(width = 64, height = 64): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 12, g: 34, b: 56 },
    },
  })
    .png()
    .toBuffer();
}

/** Renders and narrows without a forbidden non-null assertion. */
async function render(width: number, height: number): Promise<Buffer> {
  const out = await makeThumbnail(await png(width, height));
  if (out === null) {
    throw new Error('expected a thumbnail');
  }
  return out;
}

describe('makeThumbnail (unit)', () => {
  it('renders a width-bounded WebP from a real image', async () => {
    const out = await render(1200, 600);

    expect(out.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(out.subarray(8, 12).toString('ascii')).toBe('WEBP');
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBeLessThanOrEqual(300);
  });

  it('never enlarges a small image beyond its original width', async () => {
    const out = await render(40, 40);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(40);
  });

  it('returns null for undecodable bytes instead of throwing', async () => {
    await expect(
      makeThumbnail(Buffer.from('not-an-image')),
    ).resolves.toBeNull();
    await expect(makeThumbnail(Buffer.alloc(0))).resolves.toBeNull();
  });
});
