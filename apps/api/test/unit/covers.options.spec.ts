import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  COVERS_DIR_NAME,
  DEFAULT_COVERS_DIR,
  REPO_ROOT,
  resolveCoversDir,
} from '../../src/covers/covers.options';

const repoRoot = resolve(__dirname, '../../../..');

describe('cover cache options (unit)', () => {
  it('locates the workspace root from the source file, not the cwd', () => {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    ) as { workspaces?: string[] };

    expect(REPO_ROOT).toBe(repoRoot);
    expect(Array.isArray(manifest.workspaces)).toBe(true);
  });

  it('defaults to the git-ignored covers/ in the repository root', () => {
    expect(COVERS_DIR_NAME).toBe('covers');
    expect(DEFAULT_COVERS_DIR).toBe(join(repoRoot, 'covers'));
  });

  it.each([undefined, null, '', '   '])(
    'falls back to the default for %p',
    (raw) => {
      expect(resolveCoversDir(raw)).toBe(DEFAULT_COVERS_DIR);
    },
  );

  it('resolves a relative path against the repository root', () => {
    expect(resolveCoversDir('covers-alt')).toBe(join(repoRoot, 'covers-alt'));
    expect(resolveCoversDir('  ./tmp/covers  ')).toBe(
      join(repoRoot, 'tmp', 'covers'),
    );
  });

  it('keeps an absolute path unchanged', () => {
    const absolute = join(repoRoot, 'somewhere', 'else');

    expect(resolveCoversDir(` ${absolute} `)).toBe(absolute);
    expect(isAbsolute(resolveCoversDir(absolute))).toBe(true);
  });
});
