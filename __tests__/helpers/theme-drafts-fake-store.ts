/**
 * An in-memory stand-in for `lib/themes/drafts/store` — the store module is
 * the drafts' only door to Quilltap General, so the service, the install and
 * the asset serving can be tested end to end above it.
 *
 * Mirrors the real module's contract: ids are checked, paths stay inside the
 * draft folder, a missing file throws ENOENT, and a guarded write whose mtime
 * does not match throws `DocumentConflictError`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DocumentConflictError } from '@/lib/documents/core/errors';
import { resolveInsideSync } from '@/lib/paths/resolve-inside';
import { draftFolderPath } from '@/lib/themes/drafts/location';

interface FakeFile {
  data: Buffer;
  mtime: number;
}

/** General-relative path → file. */
export const files = new Map<string, FakeFile>();
let clock = 1_000;

export function reset(): void {
  files.clear();
  clock = 1_000;
}

function key(id: string, file: string): string {
  const folder = draftFolderPath(id);
  const inside = resolveInsideSync(`/${folder}`, file, { allowBase: false });
  return path.posix.relative('/', inside);
}

function enoent(file: string): Error {
  return Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' });
}

/** Put raw bytes at a General-relative path (for folders the module did not write). */
export function put(relativePath: string, data: Buffer | string): void {
  files.set(relativePath, { data: Buffer.from(data), mtime: ++clock });
}

export function get(id: string, file: string): Buffer | undefined {
  return files.get(key(id, file))?.data;
}

/** Copy a bundle directory into `Themes/<id>/`. */
export async function seedFromDir(id: string, dir: string): Promise<void> {
  const walk = async (rel: string): Promise<void> => {
    for (const entry of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(child);
      else put(key(id, child), await fs.readFile(path.join(dir, child)));
    }
  };
  await walk('');
}

const entry = (rel: string, f: FakeFile) => ({
  path: rel,
  sha256: createHash('sha256').update(f.data).digest('hex'),
  lastModified: new Date(f.mtime).toISOString(),
  size: f.data.length,
});

export const storeModule = {
  ThemeDraftStoreUnavailableError: class ThemeDraftStoreUnavailableError extends Error {},
  draftsStore: async () => ({ mountPointId: 'general', name: 'Quilltap General' }),
  listDraftFolders: async () => {
    const folders = new Map<string, ReturnType<typeof entry>[]>();
    for (const [rel, f] of files) {
      const m = /^Themes\/([^/]+)\/(.+)$/.exec(rel);
      if (!m) continue;
      const list = folders.get(m[1]) ?? [];
      list.push(entry(m[2], f));
      folders.set(m[1], list);
    }
    return folders;
  },
  listDraftFiles: async (_store: unknown, id: string) => {
    const prefix = `${draftFolderPath(id)}/`;
    return [...files].filter(([rel]) => rel.startsWith(prefix)).map(([rel, f]) => entry(rel.slice(prefix.length), f));
  },
  resolveDraftFile: async (_store: unknown, id: string, file: string) => ({ relativePath: key(id, file) }),
  readDraftText: async (_store: unknown, id: string, file: string) => {
    const f = files.get(key(id, file));
    if (!f) throw enoent(file);
    return { content: f.data.toString('utf-8'), mtime: f.mtime };
  },
  readDraftBytes: async (_store: unknown, id: string, file: string) => {
    const f = files.get(key(id, file));
    if (!f) throw enoent(file);
    return f.data;
  },
  writeDraftDocument: async (_store: unknown, id: string, file: string, content: string, expectedMtime?: number) => {
    const k = key(id, file);
    const current = files.get(k);
    if (expectedMtime !== undefined && current?.mtime !== expectedMtime) throw new DocumentConflictError('changed');
    const mtime = ++clock;
    files.set(k, { data: Buffer.from(content, 'utf-8'), mtime });
    return { mtime };
  },
  writeDraftFile: async (_store: unknown, id: string, file: string, data: Buffer) => {
    files.set(key(id, file), { data: Buffer.from(data), mtime: ++clock });
  },
  deleteDraftFile: async (_store: unknown, id: string, file: string) => files.delete(key(id, file)),
  deleteDraftFolder: async (_store: unknown, id: string) => {
    const prefix = `${draftFolderPath(id)}/`;
    let n = 0;
    for (const rel of [...files.keys()]) if (rel.startsWith(prefix)) (files.delete(rel), n++);
    return n;
  },
};
