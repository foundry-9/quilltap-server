/**
 * Resolved-file helpers — the one door the operator document actions use to
 * touch a filesystem-backed document, so feature code never imports `fs`.
 * Runs against a real temp directory.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  statResolvedFile,
  moveResolvedFile,
  deleteResolvedFile,
  type ResolvedPath,
} from '@/lib/doc-edit/path-resolver';

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }));
jest.mock('@/lib/instance-settings', () => ({ getGeneralMountPointId: jest.fn() }));

let dir: string;

function resolvedAt(rel: string, overrides: Partial<ResolvedPath> = {}): ResolvedPath {
  return {
    absolutePath: path.join(dir, rel),
    scope: 'document_store',
    basePath: dir,
    relativePath: rel,
    ...overrides,
  };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qt-resolved-file-ops-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('statResolvedFile', () => {
  it('reports a file with its size and mtime', async () => {
    await fs.writeFile(path.join(dir, 'a.md'), 'hello');
    const stat = await statResolvedFile(resolvedAt('a.md'));
    expect(stat).toMatchObject({ isFile: true, size: 5 });
    expect(stat?.mtime.getTime()).toBeGreaterThan(0);
  });

  it('reports a directory as not a file', async () => {
    await fs.mkdir(path.join(dir, 'sub'));
    expect((await statResolvedFile(resolvedAt('sub')))?.isFile).toBe(false);
  });

  it('returns null for a missing path and for a path under a file', async () => {
    await fs.writeFile(path.join(dir, 'a.md'), 'x');
    expect(await statResolvedFile(resolvedAt('nope.md'))).toBeNull();
    expect(await statResolvedFile(resolvedAt('a.md/child'))).toBeNull();
  });

  it('returns null for a database-backed path without touching disk', async () => {
    expect(
      await statResolvedFile(resolvedAt('a.md', { mountType: 'database', absolutePath: '' })),
    ).toBeNull();
  });
});

describe('moveResolvedFile', () => {
  it('renames a file and creates the destination folder', async () => {
    await fs.writeFile(path.join(dir, 'a.md'), 'body');
    await moveResolvedFile(resolvedAt('a.md'), resolvedAt('deep/er/b.md'));
    expect(await fs.readFile(path.join(dir, 'deep/er/b.md'), 'utf-8')).toBe('body');
    expect(await statResolvedFile(resolvedAt('a.md'))).toBeNull();
  });
});

describe('deleteResolvedFile', () => {
  it('removes the file', async () => {
    await fs.writeFile(path.join(dir, 'a.md'), 'x');
    await deleteResolvedFile(resolvedAt('a.md'));
    expect(await statResolvedFile(resolvedAt('a.md'))).toBeNull();
  });
});
