/**
 * Renaming or moving a document within its store, the rename-target math,
 * and the one `chat_documents` sweep that keeps open documents pointing at
 * the new path.
 *
 * @module lib/documents/core/move
 */

import path from 'path';
import { logger } from '@/lib/logger';
import { moveResolvedFile, type ResolvedPath } from '@/lib/doc-edit';
import { moveDatabaseDocument, DatabaseStoreError } from '@/lib/mount-index/database-store';
import { getRepositories, type RepositoryContainer } from '@/lib/repositories/factory';
import { getErrorMessage } from '@/lib/error-utils';
import { statDocument } from './read';
import { afterDocumentWrite } from './write';

export type RenameDocumentResult =
  | { ok: true }
  | { ok: false; reason: 'source-missing' | 'source-not-a-file' | 'destination-taken' };

/**
 * Whether two paths differ only in letter case — a legal rename that a
 * case-insensitive existence probe would report as a conflict with itself.
 */
function isCaseOnlyRename(from: string, to: string): boolean {
  return from !== to && from.toLowerCase() === to.toLowerCase();
}

/**
 * Move a document from one resolved path to another in the same store. A
 * database store moves the link row (`moveDatabaseDocument`); a filesystem
 * path is renamed on disk and then refreshed ({@link afterDocumentWrite}).
 * Never overwrites. `DatabaseStoreError` UNSUPPORTED (a target extension the
 * database store cannot hold) bubbles.
 */
export async function renameDocument(
  from: ResolvedPath,
  to: ResolvedPath,
): Promise<RenameDocumentResult> {
  const source = await statDocument(from);
  if (source === null) return { ok: false, reason: 'source-missing' };
  if (source === 'folder') return { ok: false, reason: 'source-not-a-file' };

  if (from.mountType === 'database' && from.mountPointId) {
    if (!isCaseOnlyRename(from.relativePath, to.relativePath)
      && (await statDocument({ ...to, mountPointId: from.mountPointId }))) {
      return { ok: false, reason: 'destination-taken' };
    }
    try {
      await moveDatabaseDocument(from.mountPointId, from.relativePath, to.relativePath);
    } catch (error) {
      if (error instanceof DatabaseStoreError && error.code === 'CONFLICT') {
        return { ok: false, reason: 'destination-taken' };
      }
      throw error;
    }
    logger.debug('renameDocument: moved database document', {
      mountPointId: from.mountPointId,
      from: from.relativePath,
      to: to.relativePath,
    });
    return { ok: true };
  }

  if (!isCaseOnlyRename(from.absolutePath, to.absolutePath) && (await statDocument(to)) !== null) {
    return { ok: false, reason: 'destination-taken' };
  }
  await moveResolvedFile(from, to);
  logger.debug('renameDocument: moved file', { from: from.relativePath, to: to.relativePath });
  afterDocumentWrite(to);
  return { ok: true };
}

export type RenameTarget =
  | { ok: true; newFilePath: string; newDisplayTitle: string }
  | { ok: false; reason: string };

/**
 * Turn a user-typed title into the rename target path: the input is the new
 * basename (directory preserved); a missing extension inherits the old one so
 * users can type "backstory" and get "backstory.md". Path separators are
 * rejected — this is a rename within the current directory, not a move.
 */
export function computeRenameTarget(currentFilePath: string, newTitle: string): RenameTarget {
  const raw = newTitle.trim();
  if (!raw) {
    return { ok: false, reason: 'Name cannot be empty' };
  }
  if (raw.includes('/') || raw.includes('\\')) {
    return { ok: false, reason: 'Name cannot contain path separators' };
  }
  if (raw === '.' || raw === '..' || raw.split(/[\\/]/).includes('..')) {
    return { ok: false, reason: 'Invalid name' };
  }

  const oldExt = path.extname(currentFilePath);
  const oldDir = path.dirname(currentFilePath);
  const newBasename = path.extname(raw) ? raw : `${raw}${oldExt}`;
  const newFilePath = oldDir === '.' || oldDir === ''
    ? newBasename
    : `${oldDir.replace(/\\/g, '/')}/${newBasename}`;

  return { ok: true, newFilePath, newDisplayTitle: path.basename(newFilePath) };
}

/**
 * Keep every `chat_documents` row still pointing at the old path (any chat's,
 * or the standalone sentinel's) in step with a move, so an open document and
 * the recent-documents list follow it instead of 404ing on the next read.
 * Best-effort: the move already landed, so a tracking failure is logged and
 * never thrown. Returns how many rows moved.
 *
 * `mountPoint` is the store name the rows were recorded under — the resolved
 * store's name, never a caller's `self` (bug 256).
 */
export async function sweepChatDocumentsAfterMove(
  params: {
    scope: string;
    mountPoint: string | null | undefined;
    oldFilePath: string;
    newFilePath: string;
    /** Defaults to the new path's basename. */
    newDisplayTitle?: string;
  },
  opts: { repos?: RepositoryContainer; logFields?: Record<string, unknown> } = {},
): Promise<number> {
  try {
    const repos = opts.repos ?? getRepositories();
    const updated = await repos.chatDocuments.renameFilePathInStore(
      params.scope,
      params.mountPoint ?? null,
      params.oldFilePath,
      params.newFilePath,
      params.newDisplayTitle ?? path.basename(params.newFilePath),
    );
    const rowsUpdated = typeof updated === 'number' ? updated : 0;
    if (rowsUpdated > 0) {
      logger.info('Swept chat_documents after a document move', {
        ...opts.logFields,
        scope: params.scope,
        mountPoint: params.mountPoint,
        from: params.oldFilePath,
        to: params.newFilePath,
        rowsUpdated,
      });
    }
    return rowsUpdated;
  } catch (error) {
    logger.warn('Failed to sweep chat_documents after a document move', {
      ...opts.logFields,
      scope: params.scope,
      mountPoint: params.mountPoint,
      from: params.oldFilePath,
      to: params.newFilePath,
      error: getErrorMessage(error),
    });
    return 0;
  }
}
