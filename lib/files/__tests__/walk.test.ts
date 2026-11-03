/**
 * @jest-environment node
 *
 * The shared recursive readdir skeleton under the storage layer's walkers,
 * against a real temporary directory.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { walkTree, type WalkEntry } from '@/lib/files/walk';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'qt-walk-'));
  await fs.mkdir(path.join(root, 'a/b'), { recursive: true });
  await fs.writeFile(path.join(root, 'a/one.md'), '1');
  await fs.writeFile(path.join(root, 'a/b/two.md'), '2');
  await fs.mkdir(path.join(root, 'skip'));
  await fs.writeFile(path.join(root, 'skip/hidden.md'), 'x');
  await fs.symlink(path.join(root, 'a'), path.join(root, 'link'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function collect(opts: Parameters<typeof walkTree>[2] = {}, descend = (e: WalkEntry) => e.name !== 'skip') {
  const seen: string[] = [];
  await walkTree(root, (e) => {
    seen.push(e.relativePath);
    return descend(e);
  }, opts);
  return seen;
}

describe('walkTree', () => {
  it('visits pre-order and descends only where the visitor says so', async () => {
    const seen = await collect({ separator: 'posix' });

    expect(seen).toEqual(expect.arrayContaining(['a', 'a/one.md', 'a/b', 'a/b/two.md', 'skip', 'link']));
    expect(seen).not.toContain('skip/hidden.md');
    expect(seen.indexOf('a')).toBeLessThan(seen.indexOf('a/b'));
    expect(seen.indexOf('a/b')).toBeLessThan(seen.indexOf('a/b/two.md'));
  });

  it('never follows a symlink, even when the visitor asks', async () => {
    const seen = await collect({ separator: 'posix' }, () => true);

    expect(seen).toContain('link');
    expect(seen.some((p) => p.startsWith('link/'))).toBe(false);
  });

  it('starts from a subfolder and joins with the native separator by default', async () => {
    const seen = await collect({ from: 'a' });

    expect(seen.sort()).toEqual([path.join('a', 'b'), path.join('a', 'b', 'two.md'), path.join('a', 'one.md')].sort());
  });

  it('hands an unreadable directory to onReadError and carries on', async () => {
    const errors: Array<[string, string | undefined]> = [];
    await walkTree(path.join(root, 'missing'), () => true, {
      onReadError: (dir, err) => errors.push([dir, err.code]),
    });

    expect(errors).toEqual([['', 'ENOENT']]);
  });

  it('gives each entry its absolute path', async () => {
    const entries: WalkEntry[] = [];
    await walkTree(root, (e) => { entries.push(e); return false; }, { separator: 'posix' });

    const a = entries.find((e) => e.name === 'a')!;
    expect(a.absolutePath).toBe(path.join(root, 'a'));
    expect(a.dirent.isDirectory()).toBe(true);
  });
});
