import {
  ImportJobsService,
  type ResolvedPlatform,
} from '../../src/import-jobs/import-jobs.service';
import { findPlatformMatch } from '../../src/platforms/platform-match';
import { PlatformsService } from '../../src/platforms/platforms.service';
import { createTestApp, type TestApp } from '../helpers/test-app';
import { resetDatabase } from '../helpers/reset';
import { seedPlatform } from '../helpers/seed';

/** Narrows a resolved platform id for the test's DB assertions. */
function mustId(resolved: ResolvedPlatform | null): number {
  if (resolved === null) {
    throw new Error('expected a resolved platform');
  }
  return resolved.platformId;
}

/**
 * Import-created platforms (ticket 4.11, spec §4.2.3/§4.6.6). Exercises
 * `ImportJobsService.resolvePlatformId` against a real database — matching,
 * creation, de-duplication, merge-then-reimport, and rename-preserves-match.
 */
describe('Platform import creation (e2e)', () => {
  let test: TestApp;
  let importJobs: ImportJobsService;
  let platforms: PlatformsService;

  beforeAll(async () => {
    test = await createTestApp();
    importJobs = test.app.get(ImportJobsService);
    platforms = test.app.get(PlatformsService);
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
  });

  afterAll(async () => {
    await test.app.close();
  });

  it('creates a flagged platform for an unknown name', async () => {
    const id = mustId(await importJobs.resolvePlatformId([], 'PlayStaton 5'));

    const platform = await test.prisma.platform.findUnique({
      where: { id },
    });
    expect(platform).toMatchObject({
      name: 'PlayStaton 5',
      addedByImport: true,
      hidden: false,
    });
    await expect(
      test.prisma.platform.count({ where: { name: 'PlayStaton 5' } }),
    ).resolves.toBe(1);
  });

  it('creates exactly one platform for two items with the same unknown name', async () => {
    const first = await importJobs.resolvePlatformId([], 'PlayStaton 5');
    const second = await importJobs.resolvePlatformId([], 'PlayStaton 5');

    expect(second?.platformId).toBe(first?.platformId);
    await expect(
      test.prisma.platform.count({ where: { name: 'PlayStaton 5' } }),
    ).resolves.toBe(1);
  });

  it('resolves a merged-away name to the target on a later import', async () => {
    const target = await seedPlatform(test.prisma, {
      name: 'PlayStation 5',
      slug: 'ps5',
    });
    const createdId = mustId(
      await importJobs.resolvePlatformId([], 'PlayStaton 5'),
    );
    expect(createdId).not.toBe(target.id);

    await platforms.merge(createdId, target.id);
    await expect(
      test.prisma.platform.findUnique({ where: { id: createdId } }),
    ).resolves.toBeNull();

    // A later import reading the misread name must land on the target.
    await expect(
      importJobs.resolvePlatformId([], 'PlayStaton 5'),
    ).resolves.toEqual({ platformId: target.id, provenance: 'photo' });
  });

  it('keeps matching the old name after a rename', async () => {
    const p = await seedPlatform(test.prisma, {
      name: 'PlayStation 5',
      slug: 'ps5',
    });

    await platforms.rename(p.id, { name: 'PS5 Slim' });

    await expect(
      importJobs.resolvePlatformId([], 'PlayStation 5'),
    ).resolves.toEqual({ platformId: p.id, provenance: 'photo' });
    const candidates = await platforms.listMatchCandidates();
    expect(findPlatformMatch(candidates, ['PlayStation 5'])?.id).toBe(p.id);
  });

  it('returns null when there is no usable platform name', async () => {
    await expect(
      importJobs.resolvePlatformId(
        [{ igdbId: 99, name: '!!!', abbreviation: '???' }],
        '   ',
      ),
    ).resolves.toBeNull();
    await expect(test.prisma.platform.count()).resolves.toBe(0);
  });

  it('uses the platform read off the photo over the candidate platforms (regression)', async () => {
    // Seed Switch first so its local id is lower than PC's: the old
    // lowest-local-id pick over candidate IGDB ids would choose Switch.
    const switchRow = await seedPlatform(test.prisma, {
      name: 'Nintendo Switch',
      slug: 'nintendo-switch',
      igdbId: 130,
      abbreviation: 'NS',
    });
    const pc = await seedPlatform(test.prisma, {
      name: 'PC (Microsoft Windows)',
      slug: 'pc',
      igdbId: 6,
      abbreviation: 'PC',
    });
    expect(switchRow.id).toBeLessThan(pc.id);

    await expect(
      importJobs.resolvePlatformId(
        [
          { igdbId: 130, name: 'Nintendo Switch', abbreviation: 'NS' },
          { igdbId: 6, name: 'PC (Microsoft Windows)', abbreviation: 'PC' },
        ],
        'PC DVD ROM',
      ),
    ).resolves.toEqual({ platformId: pc.id, provenance: 'photo' });
    await expect(test.prisma.platform.count()).resolves.toBe(2); // no junk row
  });
});
