/**
 * The sync engine's disk boundary.
 *
 * The target directory is reached only through the disk adapter — the walk,
 * the applier and the manifest — so every path is re-resolved against the
 * target and refused if it escapes. A raw `fs` call anywhere else in the
 * engine (the orchestrator once read action bytes directly) skips that seam.
 *
 * Guards:
 *   - lib/mount-index/sync/apply-disk.ts (readDiskFile)
 *   - lib/mount-index/sync/*.ts (only the adapter modules import fs)
 *
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs, readdirSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { DiskPathEscapeError, readDiskFile } from '@/lib/mount-index/sync/apply-disk';

const SYNC_DIR = path.join(process.cwd(), 'lib/mount-index/sync');
const DISK_ADAPTER_MODULES = new Set(['apply-disk.ts', 'walk-disk.ts', 'manifest.ts']);
const FS_IMPORT = /from ['"](node:)?fs(\/promises)?['"]|import\(['"](node:)?fs(\/promises)?['"]\)|require\(['"](node:)?fs(\/promises)?['"]\)/;

describe('sync engine disk boundary', () => {
  it('only the disk adapter modules import fs', () => {
    const offenders = readdirSync(SYNC_DIR)
      .filter((name) => name.endsWith('.ts') && !DISK_ADAPTER_MODULES.has(name))
      .filter((name) => FS_IMPORT.test(readFileSync(path.join(SYNC_DIR, name), 'utf-8')));
    expect(offenders).toEqual([]);
  });

  describe('readDiskFile', () => {
    let dir: string;

    beforeEach(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qt-sync-boundary-'));
    });

    afterEach(async () => {
      await fs.rm(dir, { recursive: true, force: true });
    });

    it('reads a file inside the target', async () => {
      await fs.mkdir(path.join(dir, 'chapters'));
      await fs.writeFile(path.join(dir, 'chapters/01.md'), 'Chapter the first');
      const bytes = await readDiskFile(dir, 'chapters/01.md');
      expect(bytes.toString('utf-8')).toBe('Chapter the first');
    });

    it('refuses a path that escapes the target', async () => {
      await expect(readDiskFile(dir, '../outside.md')).rejects.toBeInstanceOf(DiskPathEscapeError);
    });
  });
});
