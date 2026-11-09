/**
 * Mount-point folder operations — delete, move and copy, across both storage
 * types and (for move and copy) between stores.
 *
 * Database-backed mounts delegate to the tested `database-store` folder
 * functions (explicit `doc_mount_folders` rows). Filesystem mounts operate on
 * disk and reconcile the affected `doc_mount_file_links` rows so search/read
 * keep resolving after the move. Folder *create* lives elsewhere
 * (`folders/route.ts` → `createDatabaseFolder` / `createFilesystemFolder`);
 * this module is the delete/move/copy companion the action-dispatch route
 * calls.
 *
 * Whole-folder work between stores, and a recursive delete, walk the folder
 * and call the per-file operations (`file-ops.ts`) — no storage code of their
 * own — so every file keeps the sha-verified, strategy-picking behaviour of a
 * single-file move or copy. A copy or cross-store move that fails part-way is
 * undone before the error is rethrown.
 *
 * @module mount-index/folder-ops
 */

import path from 'path';
import { promises as fs } from 'fs';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { DocMountPoint } from '@/lib/schemas/mount-index.types';
import { FileOpError } from './file-op-error';
import { normaliseRelativePath } from './path-utils';
import { copyFile, deleteFile, moveFile, resolveFsAbsolute } from './file-ops';
import { createDatabaseFolder, deleteDatabaseFolder, moveDatabaseFolder } from './database-store';
import { emitDocumentMoved } from './db-store-events';
import { createFilesystemFolder, listFilesystemFolders } from './scanner';
import { publishMountChange } from './realtime';

const logger = createServiceLogger('MountIndex:FolderOps');

function isFilesystemMount(mp: DocMountPoint): boolean {
  return mp.mountType === 'filesystem' || mp.mountType === 'obsidian';
}

async function loadMount(mountPointId: string): Promise<DocMountPoint> {
  const repos = getRepositories();
  const mp = await repos.docMountPoints.findById(mountPointId);
  if (!mp) throw new FileOpError(`Mount point not found: ${mountPointId}`, 'MOUNT_NOT_FOUND');
  return mp;
}

export interface FolderOpResult {
  mountPointId: string;
  path: string;
}

/**
 * Delete an empty folder. Refuses non-empty folders (parallels the file
 * delete's safety): callers must clear contents first.
 */
async function deleteEmptyFolder(input: {
  mountPointId: string;
  relativePath: string;
}): Promise<FolderOpResult> {
  const mp = await loadMount(input.mountPointId);
  const rel = normaliseRelativePath(input.relativePath);

  if (!isFilesystemMount(mp)) {
    // Throws DatabaseStoreError NOT_FOUND / NOT_EMPTY → mapped by fileOpStatus.
    await deleteDatabaseFolder(mp.id, rel);
    return { mountPointId: mp.id, path: rel };
  }

  const abs = resolveFsAbsolute(mp, rel);
  let entries: string[];
  try {
    entries = await fs.readdir(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new FileOpError(`Folder not found: ${rel}`, 'SOURCE_NOT_FOUND');
    }
    throw err;
  }
  if (entries.length > 0) {
    throw new FileOpError(`Folder is not empty: ${rel}. Only empty folders can be deleted.`, 'CONFLICT');
  }
  await fs.rmdir(abs);
  // The scanner's row for the folder goes with it, or the listing keeps it.
  const repos = getRepositories();
  const row = await repos.docMountFolders.findByMountPointAndPath(mp.id, rel);
  if (row) {
    await repos.docMountFolders.delete(row.id);
    logger.debug('Removed filesystem folder row with the folder', { mountPointId: mp.id, path: rel });
  }
  return { mountPointId: mp.id, path: rel };
}

/**
 * Move/rename a folder and everything under it, within one store.
 */
async function moveFolderWithinMount(input: {
  mountPointId: string;
  fromPath: string;
  toPath: string;
}): Promise<{ mountPointId: string; fromPath: string; toPath: string }> {
  const mp = await loadMount(input.mountPointId);
  const fromRel = normaliseRelativePath(input.fromPath);
  const toRel = normaliseRelativePath(input.toPath);

  if (fromRel === toRel) {
    throw new FileOpError(`Source and destination are the same folder: ${toRel}`, 'INVALID_PATH');
  }

  if (!isFilesystemMount(mp)) {
    await moveDatabaseFolder(mp.id, fromRel, toRel);
    await sweepOpenDocuments(mp, fromRel, toRel);
    return { mountPointId: mp.id, fromPath: fromRel, toPath: toRel };
  }

  // Filesystem mount: rename on disk, then rewrite the affected link rows so
  // search/read keep resolving. fs links live in doc_mount_file_links with the
  // path the scanner indexed; rewriting the prefix keeps them pointing at the
  // moved bytes until the next full scan.
  const repos = getRepositories();
  const fromAbs = resolveFsAbsolute(mp, fromRel);
  const toAbs = resolveFsAbsolute(mp, toRel);

  try {
    await fs.access(fromAbs);
  } catch {
    throw new FileOpError(`Folder not found: ${fromRel}`, 'SOURCE_NOT_FOUND');
  }
  // Case-only rename (lore → Lore): on a case-insensitive filesystem the
  // destination probe would find the source itself, so skip it — fs.rename
  // handles the casing change in place.
  const caseOnlyRename = fromRel.toLowerCase() === toRel.toLowerCase();
  if (!caseOnlyRename) {
    try {
      await fs.access(toAbs);
      throw new FileOpError(`Destination already exists: ${toRel}`, 'DEST_EXISTS');
    } catch (err) {
      if (err instanceof FileOpError) throw err;
      // ENOENT is the happy path (destination free).
    }
  }

  await fs.mkdir(path.dirname(toAbs), { recursive: true });
  await fs.rename(fromAbs, toAbs);

  const oldPrefix = `${fromRel}/`;
  const newPrefix = `${toRel}/`;
  // A case-insensitive disk (APFS, NTFS) renames `Notes/` when asked for
  // `notes`, so the index rows are matched the same way, as `under()` and the
  // database store's NOCASE lookups do (#147). Only the prefix's length is
  // sliced off, which is the same in either casing.
  const fromLower = fromRel.toLowerCase();
  const isUnderSource = (p: string): boolean => under(p, fromRel);

  // The scanner records a filesystem store's folders as rows too. Carry them
  // along in place (ids kept, so the moved links' folderId stays right), or
  // the old path lingers in the listing beside the new one.
  const folderRows = await repos.docMountFolders.findByMountPointId(mp.id);
  const sourceRow = folderRows.find((f) => typeof f.path === 'string' && f.path.toLowerCase() === fromLower);
  if (sourceRow) {
    const destDir = path.posix.dirname(toRel);
    let parentId: string | null = null;
    if (destDir !== '.') {
      const { ensureFolderPath } = await import('@/lib/mount-index/folder-paths');
      parentId = await ensureFolderPath(mp.id, destDir);
    }
    await repos.docMountFolders.update(sourceRow.id, { parentId, name: path.posix.basename(toRel), path: toRel });
    for (const row of folderRows) {
      if (typeof row.path === 'string' && isUnderSource(row.path)) {
        await repos.docMountFolders.update(row.id, { path: newPrefix + row.path.slice(oldPrefix.length) });
      }
    }
    logger.debug('Moved filesystem folder rows with the folder', {
      mountPointId: mp.id,
      fromPath: fromRel,
      toPath: toRel,
      rows: 1 + folderRows.filter((r) => typeof r.path === 'string' && isUnderSource(r.path)).length,
    });
  }
  const links = await repos.docMountFileLinks.findByMountPointId(mp.id);
  for (const link of links) {
    if (!isUnderSource(link.relativePath)) continue;
    const newPath = newPrefix + link.relativePath.slice(oldPrefix.length);
    await repos.docMountFileLinks.update(link.id, {
      relativePath: newPath,
      fileName: path.posix.basename(newPath),
    });
    emitDocumentMoved({ mountPointId: mp.id, fromRelativePath: link.relativePath, toRelativePath: newPath });
  }

  await sweepOpenDocuments(mp, fromRel, toRel);
  return { mountPointId: mp.id, fromPath: fromRel, toPath: toRel };
}

/**
 * Carry the Document-Mode rows open under a moved folder to its new path, as
 * the doc tools' folder moves do. Best-effort (the sweep logs and swallows its
 * own failures). Loaded lazily: the document core sits above this module.
 */
async function sweepOpenDocuments(mp: DocMountPoint, fromRel: string, toRel: string): Promise<void> {
  const { sweepChatDocumentsAfterFolderMove } = await import('@/lib/documents/core');
  const swept = await sweepChatDocumentsAfterFolderMove({
    scope: 'document_store',
    mountPoint: mp.name,
    mountPointId: mp.id,
    oldFolderPath: fromRel,
    newFolderPath: toRel,
  });
  logger.debug('Swept open documents after a store-browser folder move', {
    mountPointId: mp.id,
    fromPath: fromRel,
    toPath: toRel,
    rowsUpdated: swept,
  });
}

// ============================================================================
// Whole-folder walks: recursive delete, copy, move between stores
// ============================================================================

interface FolderTree {
  /** The folder itself exists (a folder row / a directory, or files under it). */
  exists: boolean;
  /** Every indexed file under the folder, at any depth. */
  files: string[];
  /** Every subfolder under the folder, at any depth (not the folder itself). */
  folders: string[];
}

const under = (child: string, folder: string): boolean =>
  child.toLowerCase().startsWith(`${folder.toLowerCase()}/`);

const depthOf = (rel: string): number => rel.split('/').length;

async function readFolderTree(mp: DocMountPoint, rel: string): Promise<FolderTree> {
  const repos = getRepositories();
  const links = await repos.docMountFileLinks.findByMountPointId(mp.id);
  const files = links.map((l) => l.relativePath).filter((p) => under(p, rel));
  let folders: string[];
  let folderItself: boolean;
  if (isFilesystemMount(mp)) {
    folders = (await listFilesystemFolders(mp.basePath ?? '', mp.excludePatterns ?? [])).filter((f) => under(f, rel));
    folderItself = await fs.stat(resolveFsAbsolute(mp, rel)).then((st) => st.isDirectory(), () => false);
  } else {
    const rows = await repos.docMountFolders.findByMountPointId(mp.id);
    folders = rows.map((r) => r.path).filter((p): p is string => typeof p === 'string' && under(p, rel));
    folderItself = (await repos.docMountFolders.findByMountPointAndPath(mp.id, rel)) !== null;
  }
  return { exists: folderItself || files.length > 0, files, folders };
}

async function createFolderAt(mp: DocMountPoint, rel: string): Promise<void> {
  if (isFilesystemMount(mp)) await createFilesystemFolder(mp.basePath ?? '', mp.id, rel);
  else await createDatabaseFolder(mp.id, rel);
}

/** Files on disk under a filesystem folder that the store does not index. */
async function unindexedFilesUnder(mp: DocMountPoint, rel: string, indexed: readonly string[]): Promise<string[]> {
  const known = new Set(indexed.map((p) => p.toLowerCase()));
  const found: string[] = [];
  const walk = async (dirRel: string): Promise<void> => {
    const entries = await fs.readdir(resolveFsAbsolute(mp, dirRel), { withFileTypes: true });
    for (const entry of entries) {
      const childRel = `${dirRel}/${entry.name}`;
      if (entry.isDirectory()) await walk(childRel);
      else if (!known.has(childRel.toLowerCase())) found.push(childRel);
    }
  };
  await walk(rel);
  return found;
}

/** Remove a folder's (now empty) subfolders deepest first, then the folder. */
async function removeEmptyFolders(mp: DocMountPoint, rel: string, subfolders: readonly string[]): Promise<void> {
  const ordered = [...subfolders].sort((a, b) => depthOf(b) - depthOf(a));
  for (const folder of [...ordered, rel]) {
    await deleteEmptyFolder({ mountPointId: mp.id, relativePath: folder }).catch((err) => {
      // A filesystem folder with no row of its own is fine to skip once empty
      // of what the store knows; anything else is the caller's to hear.
      if (err instanceof FileOpError && err.code === 'SOURCE_NOT_FOUND') return;
      if ((err as { code?: string }).code === 'NOT_FOUND') return;
      throw err;
    });
  }
}

/**
 * Delete a folder. Without `recursive` it must be empty. With it, every
 * indexed file under it goes through the per-file delete (so shared content
 * is reclaimed only with its last link), then its folders, deepest first. A
 * filesystem folder holding files the store does not index is refused before
 * anything is deleted.
 */
export async function deleteFolder(input: {
  mountPointId: string;
  relativePath: string;
  recursive?: boolean;
}): Promise<FolderOpResult & { deletedFiles: number }> {
  if (!input.recursive) {
    const result = await deleteEmptyFolder(input);
    publishMountChange(result.mountPointId);
    return { ...result, deletedFiles: 0 };
  }
  const mp = await loadMount(input.mountPointId);
  const rel = normaliseRelativePath(input.relativePath);
  const tree = await readFolderTree(mp, rel);
  if (!tree.exists) throw new FileOpError(`Folder not found: ${rel}`, 'SOURCE_NOT_FOUND');
  if (isFilesystemMount(mp)) {
    const strays = await unindexedFilesUnder(mp, rel, tree.files);
    if (strays.length > 0) {
      throw new FileOpError(
        `Folder holds ${strays.length} file(s) the store does not index (${strays.slice(0, 3).join(', ')}${strays.length > 3 ? ', …' : ''}); remove them on disk first.`,
        'CONFLICT',
      );
    }
  }
  for (const file of tree.files) {
    await deleteFile({ mountPointId: mp.id, relativePath: file });
  }
  await removeEmptyFolders(mp, rel, tree.folders);
  publishMountChange(mp.id);
  logger.info('Deleted folder recursively', { mountPointId: mp.id, path: rel, files: tree.files.length, folders: tree.folders.length });
  return { mountPointId: mp.id, path: rel, deletedFiles: tree.files.length };
}

export interface FolderTransferResult {
  mountPointId: string;
  fromPath: string;
  destMountPointId: string;
  toPath: string;
  /** Files carried (absent for a move within one store, which moves the folder whole). */
  files?: number;
  /** Folders made at the destination (absent likewise). */
  folders?: number;
}

interface FolderTransferInput {
  mountPointId: string;
  fromPath: string;
  destMountPointId?: string;
  toPath: string;
}

/** Load both ends, normalise both paths, and refuse a folder into itself or onto an existing one. */
async function planFolderTransfer(input: FolderTransferInput) {
  const source = await loadMount(input.mountPointId);
  const dest = input.destMountPointId && input.destMountPointId !== source.id
    ? await loadMount(input.destMountPointId)
    : source;
  const fromRel = normaliseRelativePath(input.fromPath);
  const toRel = normaliseRelativePath(input.toPath);
  if (dest.id === source.id && (fromRel.toLowerCase() === toRel.toLowerCase() || under(toRel, fromRel))) {
    throw new FileOpError(`A folder cannot be put inside itself: ${toRel}`, 'INVALID_PATH');
  }
  const tree = await readFolderTree(source, fromRel);
  if (!tree.exists) throw new FileOpError(`Folder not found: ${fromRel}`, 'SOURCE_NOT_FOUND');
  if ((await readFolderTree(dest, toRel)).exists) {
    throw new FileOpError(`Destination already exists: ${toRel}`, 'DEST_EXISTS');
  }
  const rebase = (p: string): string => `${toRel}${p.slice(fromRel.length)}`;
  return { source, dest, fromRel, toRel, tree, rebase };
}

/** Make the destination folder and its subfolders, shallowest first; answer what was made. */
async function makeDestFolders(dest: DocMountPoint, toRel: string, subfolders: readonly string[]): Promise<string[]> {
  const made: string[] = [];
  for (const folder of [toRel, ...[...subfolders].sort((a, b) => depthOf(a) - depthOf(b))]) {
    await createFolderAt(dest, folder);
    made.push(folder);
  }
  return made;
}

/**
 * Copy a folder and everything in it — to another path in the same store, or
 * into another store. Each file is a per-file copy (dedup-linked where both
 * ends are database stores, a byte copy across storage types); empty
 * subfolders are made too. Refused onto an existing folder; undone on
 * failure.
 */
export async function copyFolder(input: FolderTransferInput): Promise<FolderTransferResult> {
  const { source, dest, fromRel, toRel, tree, rebase } = await planFolderTransfer(input);
  const madeFolders = await makeDestFolders(dest, toRel, tree.folders.map(rebase));
  const copied: string[] = [];
  try {
    for (const file of tree.files) {
      const result = await copyFile({ sourceMountPointId: source.id, sourcePath: file, destMountPointId: dest.id, destPath: rebase(file) });
      copied.push(result.destPath);
    }
  } catch (err) {
    logger.warn('Folder copy failed; undoing', { mountPointId: source.id, fromRel, destMountPointId: dest.id, toRel, copied: copied.length, error: err instanceof Error ? err.message : String(err) });
    for (const file of copied) await deleteFile({ mountPointId: dest.id, relativePath: file }).catch(() => undefined);
    await removeEmptyFolders(dest, toRel, madeFolders.filter((f) => f !== toRel)).catch(() => undefined);
    publishMountChange(dest.id);
    throw err;
  }
  publishMountChange(dest.id);
  logger.info('Copied folder', { mountPointId: source.id, fromRel, destMountPointId: dest.id, toRel, files: copied.length, folders: madeFolders.length });
  return { mountPointId: source.id, fromPath: fromRel, destMountPointId: dest.id, toPath: toRel, files: copied.length, folders: madeFolders.length };
}

/**
 * Move or rename a folder. Within one store it is a single folder move (the
 * database rows or the directory, every link following). Into another store
 * each file is a per-file move — a database → database move keeps every link's
 * identity and hard-link group — then the emptied source folders go; a move
 * that fails part-way moves what it had moved back.
 */
export async function moveFolder(input: FolderTransferInput): Promise<FolderTransferResult> {
  if (!input.destMountPointId || input.destMountPointId === input.mountPointId) {
    const result = await moveFolderWithinMount(input);
    publishMountChange(result.mountPointId);
    return { ...result, destMountPointId: result.mountPointId };
  }
  const { source, dest, fromRel, toRel, tree, rebase } = await planFolderTransfer(input);
  if (isFilesystemMount(source)) {
    const strays = await unindexedFilesUnder(source, fromRel, tree.files);
    if (strays.length > 0) {
      throw new FileOpError(
        `Folder holds ${strays.length} file(s) the store does not index; they cannot move with it.`,
        'CONFLICT',
      );
    }
  }
  const madeFolders = await makeDestFolders(dest, toRel, tree.folders.map(rebase));
  const moved: Array<{ from: string; to: string }> = [];
  try {
    for (const file of tree.files) {
      const result = await moveFile({ sourceMountPointId: source.id, sourcePath: file, destMountPointId: dest.id, destPath: rebase(file) });
      moved.push({ from: file, to: result.destPath });
    }
  } catch (err) {
    logger.warn('Folder move failed; moving back', { mountPointId: source.id, fromRel, destMountPointId: dest.id, toRel, moved: moved.length, error: err instanceof Error ? err.message : String(err) });
    for (const { from, to } of moved.reverse()) {
      await moveFile({ sourceMountPointId: dest.id, sourcePath: to, destMountPointId: source.id, destPath: from }).catch((undoErr) => {
        logger.error('Could not move a file back after a failed folder move', { from: to, to: from, error: undoErr instanceof Error ? undoErr.message : String(undoErr) });
      });
    }
    await removeEmptyFolders(dest, toRel, madeFolders.filter((f) => f !== toRel)).catch(() => undefined);
    publishMountChange(source.id);
    publishMountChange(dest.id);
    throw err;
  }
  await removeEmptyFolders(source, fromRel, tree.folders);
  publishMountChange(source.id);
  publishMountChange(dest.id);
  logger.info('Moved folder between stores', { mountPointId: source.id, fromRel, destMountPointId: dest.id, toRel, files: moved.length, folders: madeFolders.length });
  return { mountPointId: source.id, fromPath: fromRel, destMountPointId: dest.id, toPath: toRel, files: moved.length, folders: madeFolders.length };
}
