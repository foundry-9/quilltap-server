/**
 * The one recursive `readdir` skeleton under the storage layer's walkers.
 *
 * Four walkers share it — the document-store scanner (`walkDirectory`), the
 * folder picker (`listFilesystemFolders`), the sync engine's disk walk
 * (`walkDisk`) and the `files/` scanner (`scanDirectory`). Their filter rules
 * differ on purpose (include/exclude patterns, fixed skip rules, dot-entries
 * and sidecars), so each keeps its own predicate in its visitor; what they
 * share is only the shape of the walk:
 *
 *   - depth-first, pre-order: a directory is visited before its contents, so
 *     a walker can record a folder before anything beneath it;
 *   - a directory is descended only when its visitor returns `true`;
 *   - a symlink is never followed. `readdir`'s dirent for one answers
 *     `isDirectory() === false`, so it cannot be descended; the visitor still
 *     sees it, for a walker that wants to warn about it;
 *   - a directory that cannot be read is handed to `onReadError` and skipped.
 *
 * @module files/walk
 */

import path from 'path';
import fs from 'fs/promises';
import type { Dirent } from 'fs';

export interface WalkEntry {
  /** The entry's own name. */
  name: string;
  /** Path from the walk's root, joined with the walk's separator. */
  relativePath: string;
  /** Absolute path on disk. */
  absolutePath: string;
  dirent: Dirent;
}

export interface WalkOptions {
  /** Relative directory to start from (joined with the walk's separator); default the root. */
  from?: string;
  /**
   * How `relativePath` is joined: `'native'` uses `path.join` (the document
   * stores' convention), `'posix'` uses `'/'` (storage keys and sync paths).
   * Default `'native'`.
   */
  separator?: 'native' | 'posix';
  /** A directory `readdir` refused. `relativeDir` is `''` for the root. */
  onReadError?: (relativeDir: string, err: NodeJS.ErrnoException) => void;
}

/** Return `true` to descend into a directory; anything else leaves it unwalked. */
export type WalkVisitor = (entry: WalkEntry) => boolean | void | Promise<boolean | void>;

export async function walkTree(
  root: string,
  visit: WalkVisitor,
  options: WalkOptions = {},
): Promise<void> {
  const join =
    options.separator === 'posix'
      ? (dir: string, name: string) => (dir ? `${dir}/${name}` : name)
      : (dir: string, name: string) => (dir ? path.join(dir, name) : name);

  async function walk(relativeDir: string): Promise<void> {
    const absoluteDir = relativeDir ? path.join(root, relativeDir) : root;
    let dirents: Dirent[];
    try {
      dirents = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch (err) {
      options.onReadError?.(relativeDir, err as NodeJS.ErrnoException);
      return;
    }

    for (const dirent of dirents) {
      const relativePath = join(relativeDir, dirent.name);
      const descend = await visit({
        name: dirent.name,
        relativePath,
        absolutePath: path.join(root, relativePath),
        dirent,
      });
      if (descend === true && dirent.isDirectory()) {
        await walk(relativePath);
      }
    }
  }

  await walk(options.from ?? '');
}
