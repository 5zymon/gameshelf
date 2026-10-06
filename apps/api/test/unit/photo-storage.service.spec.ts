import { ConfigService } from '@nestjs/config';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PhotoStorageService } from '../../src/import-jobs/photo-storage.service';
import { DEFAULT_IMPORT_PHOTOS_DIR } from '../../src/import-jobs/upload.options';

function createService(directory: string | undefined): PhotoStorageService {
  const config = {
    get: (): string | undefined => directory,
  } as unknown as ConfigService;
  return new PhotoStorageService(config);
}

function uploadedFile(
  overrides: Partial<Express.Multer.File>,
): Express.Multer.File {
  return {
    originalname: 'a.png',
    mimetype: 'image/png',
    buffer: Buffer.from('x'),
    ...overrides,
  } as Express.Multer.File;
}

describe('PhotoStorageService (unit)', () => {
  it('writes a uniquely named file with the mime-derived extension', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gs-photo-'));
    const service = createService(dir);

    const first = await service.store(uploadedFile({}));
    const second = await service.store(uploadedFile({}));

    expect(first).toMatch(/\.png$/);
    expect(second).toMatch(/\.png$/);
    expect(first).not.toBe(second);
    expect(existsSync(join(dir, first))).toBe(true);
    expect(existsSync(join(dir, second))).toBe(true);
  });

  it('maps the mimetype to the extension', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gs-photo-'));
    const service = createService(dir);

    expect(
      await service.store(uploadedFile({ mimetype: 'image/jpeg' })),
    ).toMatch(/\.jpg$/);
    expect(
      await service.store(uploadedFile({ mimetype: 'image/webp' })),
    ).toMatch(/\.webp$/);
  });

  it('falls back to the default directory when the env var is blank/absent', () => {
    expect(createService(undefined).directory).toBe(DEFAULT_IMPORT_PHOTOS_DIR);
    expect(createService('   ').directory).toBe(DEFAULT_IMPORT_PHOTOS_DIR);
  });

  describe('read', () => {
    it('returns the stored bytes and the mime type derived from the extension', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'gs-photo-'));
      const service = createService(dir);
      const photoRef = await service.store(
        uploadedFile({ buffer: Buffer.from('png-bytes') }),
      );

      const read = await service.read(photoRef);

      expect(read.buffer).toEqual(Buffer.from('png-bytes'));
      expect(read.mimeType).toBe('image/png');
    });

    it.each([
      ['image/jpeg', 'image/jpeg'],
      ['image/webp', 'image/webp'],
    ])('round-trips %s', async (mimetype, expected) => {
      const dir = mkdtempSync(join(tmpdir(), 'gs-photo-'));
      const service = createService(dir);
      const photoRef = await service.store(uploadedFile({ mimetype }));

      expect((await service.read(photoRef)).mimeType).toBe(expected);
    });
  });

  describe('delete', () => {
    it('removes the stored file', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'gs-photo-'));
      const service = createService(dir);
      const photoRef = await service.store(uploadedFile({}));

      await service.delete(photoRef);

      expect(existsSync(join(dir, photoRef))).toBe(false);
    });

    it('tolerates a missing file (ENOENT)', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'gs-photo-'));
      const service = createService(dir);

      await expect(service.delete('missing.png')).resolves.toBeUndefined();
    });

    it('is a no-op for a null reference', async () => {
      const service = createService(undefined);

      await expect(service.delete(null)).resolves.toBeUndefined();
    });
  });
});
