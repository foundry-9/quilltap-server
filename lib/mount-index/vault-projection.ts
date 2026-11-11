/**
 * Generic vault-folder projection helper shared by the wardrobe sync chain,
 * the full-character writer, and the write overlay.
 *
 * @module database/repositories/vault-overlay/vault-projection
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  writeDatabaseDocument,
  deleteDatabaseDocument,
} from '@/lib/mount-index/database-store';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { foldStorePath } from '@/lib/mount-index/store-path-fold';

/** Options for {@link projectArrayIntoVaultFolder}. */
export interface ProjectArrayOptions {
  /**
   * File names (case-insensitive) exempt from both the sweep and the
   * projected name pool. Matched against the file segment at any depth in
   * recursive mode, at the folder's root otherwise.
   */
  preserveFileNames?: readonly string[];
  /**
   * Recursive projection: the mapper may return a `fileName` with `/`
   * separators (a folder path under `folder`), the existing-file listing is
   * recursive, and the sweep deletes stale `.md` at any depth except under
   * `excludeSubfolders` (first segment under `folder`, case-insensitive).
   * Folders themselves are never deleted.
   */
  recursive?: { excludeSubfolders: readonly string[] };
  /**
   * Which existing files the projection owns and may sweep. Without it every
   * stale `.md` is swept (the flat callers' behaviour); with it, a file it
   * rejects — a note kept beside the items — is left alone.
   */
  ownsFile?: (doc: { relativePath: string; content?: string | null }) => boolean;
  /**
   * The extension of the files the projection lists and may sweep. Default
   * `.md` (every markdown caller); the Inventory projects `.json` objects.
   * Only files with this extension are ever considered — the mapper's
   * `content` is written as given, so the serialiser is the mapper's.
   */
  ext?: string;
}

/**
 * Replace a vault folder's contents with a fresh projection of an array.
 * Files corresponding to items in `items` are written; any other files
 * currently in the folder are deleted, so the vault listing matches the
 * incoming array exactly. Naming collisions are disambiguated with
 * `-1`, `-2`, … suffixes — per folder in recursive mode, so `A/Coat.md` and
 * `B/Coat.md` both keep their names.
 *
 * `opts.preserveFileNames` exempts specific file names (case-insensitive)
 * from both the sweep and the projected name pool, so a hand-kept file like
 * `Wardrobe/instructions.md` survives every projection and an item whose
 * title maps to the same name lands on a `-1` suffix instead of overwriting
 * it.
 *
 * `opts.recursive` is off by default; the flat callers (prompts, scenarios)
 * see exactly the top-level behaviour they always have. `opts.ownsFile`
 * narrows the sweep to the files the caller owns.
 */
export async function projectArrayIntoVaultFolder<T>(
  mountPointId: string,
  folder: string,
  items: readonly T[],
  mapper: (item: T) => { fileName: string; content: string },
  characterId: string,
  opts?: ProjectArrayOptions,
): Promise<void> {
  const repos = getRepositories();
  const preserved = new Set((opts?.preserveFileNames ?? []).map((name) => foldStorePath(name)));
  const recursive = opts?.recursive;
  const excluded = new Set((recursive?.excludeSubfolders ?? []).map((name) => foldStorePath(name)));
  const existing = await repos.docMountDocuments.findManyByMountPointsInFolder(
    [mountPointId],
    folder,
    opts?.ext ?? '.md',
    recursive ? { recursive: true } : undefined,
  );
  const existingByPath = new Map(existing.map((d) => [d.relativePath, d]));

  const mappedItems = items.map((item) => mapper(item));

  // Every folder the projection writes into, created once each before the
  // writes. Flat mode only ever writes into `folder` itself.
  const subfolders = new Map<string, string>();
  for (const mapped of mappedItems) {
    const slash = mapped.fileName.lastIndexOf('/');
    const sub = recursive && slash >= 0 ? mapped.fileName.slice(0, slash) : '';
    if (!subfolders.has(foldStorePath(sub))) subfolders.set(foldStorePath(sub), sub);
  }
  // A folder already holding a document exists; ensure only the others (a
  // write would create them too, but an empty projection target must exist).
  // Flat mode keeps its one unconditional ensure.
  const occupied = new Set(
    existing.map((d) => foldStorePath(d.relativePath.slice(0, d.relativePath.lastIndexOf('/')))),
  );
  for (const sub of subfolders.values()) {
    const target = sub ? `${folder}/${sub}` : folder;
    if (recursive && occupied.has(foldStorePath(target))) continue;
    await ensureFolderPath(mountPointId, target);
  }
  if (subfolders.size > 1 || (recursive && subfolders.size === 1 && !subfolders.has(''))) {
    logger.debug('Recursive vault projection ensured subfolders', {
      characterId,
      mountPointId,
      folder,
      subfolderCount: subfolders.size,
    });
  }

  // The name pool is keyed by the full folded path under `folder`, so
  // suffixing is per folder. Every path key here is `foldStorePath` — the
  // store's own NOCASE rule (ASCII only) — never `toLowerCase()`: a key that
  // folds more than the store does would call `Café.md` "already written"
  // after a write of `CAFÉ.md` minted a second row, and the sweep would keep
  // the stale file (#224). Preserved names are claimed in every folder the
  // projection writes into (just the root in flat mode).
  const seen = new Set<string>();
  for (const key of subfolders.keys()) {
    for (const name of preserved) seen.add(key ? `${key}/${name}` : name);
  }
  const writtenPaths = new Set<string>();
  for (const mapped of mappedItems) {
    let candidate = mapped.fileName;
    let n = 1;
    while (seen.has(foldStorePath(candidate))) {
      const slash = mapped.fileName.lastIndexOf('/');
      const dot = mapped.fileName.lastIndexOf('.');
      const hasExt = dot > slash;
      const base = hasExt ? mapped.fileName.slice(0, dot) : mapped.fileName;
      const ext = hasExt ? mapped.fileName.slice(dot) : '';
      candidate = `${base}-${n}${ext}`;
      n++;
    }
    seen.add(foldStorePath(candidate));
    const relPath = `${folder}/${candidate}`;
    writtenPaths.add(foldStorePath(relPath));
    await writeDatabaseDocument(mountPointId, relPath, mapped.content);
  }

  const folderPrefixLength = folder.length + 1;
  const writtenLower = new Set([...writtenPaths].map((p) => p.toLowerCase()));
  for (const [relPath, doc] of existingByPath) {
    if (writtenPaths.has(foldStorePath(relPath))) continue;
    const fileSegment = foldStorePath(relPath.slice(relPath.lastIndexOf('/') + 1));
    if (preserved.has(fileSegment)) continue;
    if (opts?.ownsFile && !opts.ownsFile(doc)) continue;
    if (recursive) {
      const rest = relPath.slice(folderPrefixLength);
      const firstSlash = rest.indexOf('/');
      if (firstSlash >= 0 && excluded.has(foldStorePath(rest.slice(0, firstSlash)))) continue;
    }
    logger.debug('Vault projection sweeping a stale file', {
      characterId,
      mountPointId,
      relativePath: relPath,
      // A path that only `toLowerCase()` would equate with a written one is a
      // separate row to the store — the stale half of a non-ASCII case-only
      // rename (#224).
      unicodeCaseVariant: writtenLower.has(relPath.toLowerCase()),
    });
    try {
      await deleteDatabaseDocument(mountPointId, relPath);
    } catch (err) {
      logger.warn('Failed to delete stale vault file during folder projection', {
        characterId,
        mountPointId,
        relativePath: relPath,
        docId: doc.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
