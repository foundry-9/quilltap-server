/**
 * Per-item writes to a character vault's sub-collection folders (`Prompts/`,
 * `Scenarios/`) — D6 of refactor-character-repository-and-vault.md.
 *
 * An item is found by its id (frontmatter `id:`, else path-derived — D5) and
 * each operation touches only the file(s) it must: adding writes one new file,
 * an edit rewrites one file (renamed through the document core when the item's
 * name changes, so `chat_documents` follow), a delete removes one. Nothing is
 * swept: a hand-written draft in the folder is never touched.
 *
 * The callers are the repository's prompt and scenario operations, which own
 * the archive guard and the `defaultSystemPromptId` column.
 *
 * @module characters/vault/items
 */

import path from 'path';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { writeDatabaseDocument } from '@/lib/mount-index/database-store';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { foldStorePath } from '@/lib/mount-index/store-path-fold';
import type { ResolvedPath } from '@/lib/doc-edit';
import type { VaultContext, VaultFolderEntry } from './layout';

/** An item as the folder holds it: where it lives, its own file's flags, and its effective view. */
export interface LocatedItem<T> {
  relativePath: string;
  /** The item exactly as its file says. */
  onDisk: T;
  /** The item after folder rules (`normalize`) — what a hydrated read returns. */
  item: T;
}

/** Every item file in the folder, in parse order (by path), with its location. */
export async function listFolderItems<T extends { id: string }>(
  entry: VaultFolderEntry<T>,
  ctx: VaultContext,
): Promise<LocatedItem<T>[]> {
  const docs = await getRepositories().docMountDocuments.findManyByMountPointsInFolder(
    [ctx.mountPointId],
    entry.folder,
    '.md',
  );
  const parsed = docs
    .slice()
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    .flatMap((doc) => {
      const onDisk = entry.parseItem(doc, ctx);
      return onDisk ? [{ relativePath: doc.relativePath, onDisk }] : [];
    });
  const normalized = entry.normalize(parsed.map((p) => p.onDisk));
  return parsed.map((p, i) => ({ ...p, item: normalized[i] }));
}

/** A free `<folder>/<name>.md`, suffixing `-1`, `-2`, … against every file in the folder. */
async function freePathFor(
  entry: VaultFolderEntry<{ id: string }>,
  ctx: VaultContext,
  fileName: string,
  ownPath?: string,
): Promise<string> {
  const docs = await getRepositories().docMountDocuments.findManyByMountPointsInFolder(
    [ctx.mountPointId],
    entry.folder,
    '.md',
  );
  // The store's own path rule (ASCII-only NOCASE), never `toLowerCase()` (#224).
  const own = ownPath === undefined ? undefined : foldStorePath(ownPath);
  const taken = new Set(
    docs.map((d) => foldStorePath(d.relativePath)).filter((p) => p !== own),
  );
  const ext = path.extname(fileName);
  const base = fileName.slice(0, fileName.length - ext.length);
  let candidate = `${entry.folder}/${fileName}`;
  for (let n = 1; taken.has(foldStorePath(candidate)); n++) {
    candidate = `${entry.folder}/${base}-${n}${ext}`;
  }
  return candidate;
}

/**
 * The document core sits above the repository layer (it reads through the
 * repository factory), so it is loaded lazily, as `folder-ops.ts` does.
 */
const documentCore = () => import('@/lib/documents/core');

/** A vault path as the document core addresses it. */
async function resolvedVaultPath(ctx: VaultContext, relativePath: string): Promise<ResolvedPath> {
  const mount = await getRepositories().docMountPoints.findById(ctx.mountPointId);
  return {
    absolutePath: '',
    scope: 'document_store',
    mountPointId: ctx.mountPointId,
    mountPointName: mount?.name,
    mountType: 'database',
    basePath: '',
    relativePath,
  };
}

/** Write a brand-new item to its own file. Returns where it landed. */
export async function addFolderItem<T extends { id: string }>(
  entry: VaultFolderEntry<T>,
  ctx: VaultContext,
  item: T,
): Promise<string> {
  await ensureFolderPath(ctx.mountPointId, entry.folder);
  const target = await freePathFor(entry as VaultFolderEntry<{ id: string }>, ctx, entry.fileNameFor(item));
  await writeDatabaseDocument(ctx.mountPointId, target, entry.renderItem(item));
  logger.debug('[CharacterVault] Added an item file', { ...ctx, folder: entry.folder, itemId: item.id, path: target });
  return target;
}

/**
 * Rewrite one item's file. When the item's name (its file name) changes, the
 * file is moved first — through the document core, so open Document-Mode rows
 * follow it — and the id in its frontmatter keeps it the same item.
 */
export async function rewriteFolderItem<T extends { id: string }>(
  entry: VaultFolderEntry<T>,
  ctx: VaultContext,
  located: LocatedItem<T>,
  next: T,
): Promise<string> {
  let target = located.relativePath;
  if (entry.fileNameFor(next) !== entry.fileNameFor(located.onDisk)) {
    const destination = await freePathFor(
      entry as VaultFolderEntry<{ id: string }>,
      ctx,
      entry.fileNameFor(next),
      located.relativePath,
    );
    if (destination !== located.relativePath) {
      const from = await resolvedVaultPath(ctx, located.relativePath);
      const to = { ...from, relativePath: destination };
      const { renameDocument, sweepChatDocumentsAfterMove } = await documentCore();
      const moved = await renameDocument(from, to);
      if (!moved.ok) {
        throw new Error(`Could not rename ${located.relativePath} to ${destination}: ${moved.reason}`);
      }
      await sweepChatDocumentsAfterMove({
        scope: 'document_store',
        mountPoint: from.mountPointName,
        mountPointId: ctx.mountPointId,
        oldFilePath: located.relativePath,
        newFilePath: destination,
      });
      logger.debug('[CharacterVault] Renamed an item file', { ...ctx, itemId: next.id, from: located.relativePath, to: destination });
      target = destination;
    }
  }
  await writeDatabaseDocument(ctx.mountPointId, target, entry.renderItem(next));
  logger.debug('[CharacterVault] Rewrote an item file', { ...ctx, folder: entry.folder, itemId: next.id, path: target });
  return target;
}

/** Delete one item's file. */
export async function removeFolderItem<T extends { id: string }>(
  entry: VaultFolderEntry<T>,
  ctx: VaultContext,
  located: LocatedItem<T>,
): Promise<void> {
  const { deleteDocument } = await documentCore();
  const outcome = await deleteDocument(await resolvedVaultPath(ctx, located.relativePath));
  logger.debug('[CharacterVault] Removed an item file', {
    ...ctx,
    folder: entry.folder,
    itemId: located.item.id,
    path: located.relativePath,
    outcome,
  });
}
