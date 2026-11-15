/**
 * The files of a theme draft, read and written through the document core and
 * `storeMountFile` — never raw fs, never a repository call beside them.
 *
 * A database store keeps two kinds of file: documents (native text — `.json`,
 * `.md`, `.txt`) and uploaded blobs (everything else: CSS, SVG, fonts,
 * raster images). Text goes through `writeDocument`; the rest through
 * `storeMountFile`, whose blob normalisation leaves anything under `Themes/`
 * byte for byte (`lib/mount-index/normalize-blob-image.ts`). Reads go through
 * `readDocument` (text) and `readDocumentBytes` (bytes), which find either kind.
 * A whole draft is deleted with the Scriptorium's recursive folder delete.
 *
 * Server only; every writer here runs in the parent process (the theme-draft
 * routes), like every caller of `storeMountFile`.
 *
 * @module lib/themes/drafts/store
 */

import path from 'node:path';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import { storeMountFile } from '@/lib/mount-index/store-file';
import { listDatabaseFiles } from '@/lib/mount-index/database-store';
import { deleteFolder } from '@/lib/mount-index/folder-ops';
import { detectNativeText, mimeForExtension } from '@/lib/mount-index/path-utils';
import { resolveInsideSync } from '@/lib/paths/resolve-inside';
import { readDocument, readDocumentBytes, writeDocument } from '@/lib/documents/core';
import { resolveOperatorDocPath, STANDALONE_ACCESS_CONTEXT } from '@/lib/documents/operator-doc-actions';
import type { ResolvedPath } from '@/lib/doc-edit';
import { draftFolderPath, isValidDraftId, THEME_DRAFTS_FOLDER } from './location';

const logger = createServiceLogger('ThemeDraftStore');

/** Quilltap General, as the drafts module needs it. */
export interface DraftsStore {
  mountPointId: string;
  name: string;
}

export class ThemeDraftStoreUnavailableError extends Error {
  constructor() {
    super('Quilltap General is not available to hold theme drafts');
    this.name = 'ThemeDraftStoreUnavailableError';
  }
}

/** The store that holds drafts, or a throw when General is not set up. */
export async function draftsStore(): Promise<DraftsStore> {
  const mountPointId = await getGeneralMountPointId();
  if (!mountPointId) throw new ThemeDraftStoreUnavailableError();
  const row = await getRepositories().docMountPoints.findById(mountPointId);
  if (!row) throw new ThemeDraftStoreUnavailableError();
  return { mountPointId, name: row.name };
}

/** One file in a draft folder. */
export interface DraftFileEntry {
  /** Path inside the draft, "/"-separated (`tokens.json`, `fonts/a.woff2`). */
  path: string;
  sha256: string;
  lastModified: string;
}

/** Every draft folder's files, keyed by folder name (which may not be a valid id). */
export async function listDraftFolders(store: DraftsStore): Promise<Map<string, DraftFileEntry[]>> {
  const entries = await listDatabaseFiles(store.mountPointId, { folder: THEME_DRAFTS_FOLDER });
  const folders = new Map<string, DraftFileEntry[]>();
  const prefix = `${THEME_DRAFTS_FOLDER}/`;
  for (const entry of entries) {
    if (!entry.relativePath.startsWith(prefix)) continue;
    const rest = entry.relativePath.slice(prefix.length);
    const slash = rest.indexOf('/');
    const folder = slash < 0 ? rest : rest.slice(0, slash);
    if (!folder) continue;
    if (entry.kind === 'folder') {
      if (slash < 0 && !folders.has(folder)) folders.set(folder, []);
      continue;
    }
    if (slash < 0) continue; // a loose file directly under Themes/ is not a draft
    const list = folders.get(folder) ?? [];
    list.push({ path: rest.slice(slash + 1), sha256: entry.sha256, lastModified: entry.lastModified });
    folders.set(folder, list);
  }
  return folders;
}

/** The files of one draft (empty when the folder is absent). */
export async function listDraftFiles(store: DraftsStore, id: string): Promise<DraftFileEntry[]> {
  const folder = draftFolderPath(id);
  const entries = await listDatabaseFiles(store.mountPointId, { folder });
  const prefix = `${folder}/`;
  return entries
    .filter((e) => e.kind !== 'folder' && e.relativePath.startsWith(prefix))
    .map((e) => ({ path: e.relativePath.slice(prefix.length), sha256: e.sha256, lastModified: e.lastModified }));
}

/**
 * Resolve a file of a draft. The id is checked against the id rule and the
 * path is resolved inside the draft folder, so neither can leave it.
 */
export async function resolveDraftFile(store: DraftsStore, id: string, file: string): Promise<ResolvedPath> {
  if (!isValidDraftId(id)) throw new Error(`Not a valid theme draft id: ${JSON.stringify(id)}`);
  const folder = draftFolderPath(id);
  const inside = resolveInsideSync(`/${folder}`, file, { allowBase: false });
  const relativePath = path.posix.relative('/', inside);
  return resolveOperatorDocPath(STANDALONE_ACCESS_CONTEXT, {
    scope: 'document_store',
    mountPoint: store.name,
    filePath: relativePath,
  });
}

/** Read a draft file as text, with its mtime. Throws an ENOENT-coded error when absent. */
export async function readDraftText(store: DraftsStore, id: string, file: string): Promise<{ content: string; mtime: number }> {
  const resolved = await resolveDraftFile(store, id, file);
  if (detectNativeText(resolved.relativePath)) {
    const read = await readDocument(resolved);
    return { content: read.content, mtime: read.mtime };
  }
  const bytes = await readDocumentBytes(resolved);
  return { content: bytes.data.toString('utf-8'), mtime: bytes.mtime };
}

/** Read a draft file's bytes. Throws an ENOENT-coded error when absent. */
export async function readDraftBytes(store: DraftsStore, id: string, file: string): Promise<Buffer> {
  return (await readDocumentBytes(await resolveDraftFile(store, id, file))).data;
}

/**
 * Write a text document into a draft (`.json`, `.md`, `.txt`), with an
 * optional mtime precondition (a `DocumentConflictError` on a miss).
 */
export async function writeDraftDocument(
  store: DraftsStore,
  id: string,
  file: string,
  content: string,
  expectedMtime?: number,
): Promise<{ mtime: number }> {
  const resolved = await resolveDraftFile(store, id, file);
  if (!detectNativeText(resolved.relativePath)) {
    throw new Error(`Not a text document a store can hold: ${file}`);
  }
  logger.debug('Writing theme draft document', { draftId: id, file, bytes: content.length, guarded: expectedMtime !== undefined });
  return writeDocument(resolved, content, expectedMtime);
}

/**
 * Write any file into a draft: text documents through the document core,
 * everything else as a blob through `storeMountFile` (replacing what is
 * there). Images are kept byte for byte by the blob chokepoint.
 */
export async function writeDraftFile(store: DraftsStore, id: string, file: string, data: Buffer): Promise<void> {
  const resolved = await resolveDraftFile(store, id, file);
  if (detectNativeText(resolved.relativePath)) {
    await writeDocument(resolved, data.toString('utf-8'));
    return;
  }
  logger.debug('Writing theme draft blob', { draftId: id, file, bytes: data.length });
  await storeMountFile({
    mountPointId: store.mountPointId,
    relativePath: resolved.relativePath,
    data,
    originalMimeType: mimeForExtension(resolved.relativePath),
    originalFileName: path.posix.basename(resolved.relativePath),
    collisionStrategy: 'overwrite',
    treatNativeTextAsDocument: false,
    extractText: false,
    enqueueEmbedding: false,
    assetStorage: 'database',
  });
}

/**
 * Delete a draft folder and everything in it, through the Scriptorium's own
 * recursive folder delete (`deleteFolder`), which removes each file through
 * the per-file delete, then the folders, and tells open store browsers.
 */
export async function deleteDraftFolder(store: DraftsStore, id: string): Promise<number> {
  const result = await deleteFolder({ mountPointId: store.mountPointId, relativePath: draftFolderPath(id), recursive: true });
  logger.debug('Deleted theme draft folder', { draftId: id, deletedFiles: result.deletedFiles });
  return result.deletedFiles;
}
