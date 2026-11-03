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
import type { ChatDocument } from '@/lib/schemas/chat-document.types';
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

/** Where a move landed, as the sweep needs it. */
interface SweepStore {
  /** The scope and store name the caller addressed the file through. */
  scope: string;
  mountPoint: string | null | undefined;
  /**
   * The resolved store's id. When given, a row recorded under a different
   * address for the same store — `project` for the project's official store,
   * or that store by name — is swept too. Without it only rows under the
   * caller's exact (scope, mountPoint) are.
   */
  mountPointId?: string | null;
}

/**
 * Decide, row by row, whether a `chat_documents` row addresses the store a
 * move happened in. With the store's id in hand, a row's own address is
 * resolved to a store id and compared: a `document_store` row by its store
 * name, a `project` row through its chat's project's official store — so a
 * `project` row from another project's chat is not swept just because it too
 * says `project`. `general` is a filesystem directory with no store id and
 * matches literally, as does every row when the caller has no store id.
 * Lookups are cached for one sweep.
 */
function sameStoreMatcher(store: SweepStore, repos: RepositoryContainer) {
  const callerMount = store.mountPoint ?? null;
  const byName = new Map<string, Promise<string | null>>();
  const byChat = new Map<string, Promise<string | null>>();

  const storeIdForName = (name: string) => {
    const key = name.trim().toLowerCase();
    let pending = byName.get(key);
    if (!pending) {
      pending = repos.docMountPoints.findByName(name)
        .then(matches => (matches.length === 1 ? matches[0].id : null));
      byName.set(key, pending);
    }
    return pending;
  };

  const storeIdForChatProject = (chatId: string) => {
    let pending = byChat.get(chatId);
    if (!pending) {
      pending = (async () => {
        const chat = await repos.chats.findById(chatId);
        if (!chat?.projectId) return null;
        const project = await repos.projects.findById(chat.projectId);
        return project?.officialMountPointId ?? null;
      })();
      byChat.set(chatId, pending);
    }
    return pending;
  };

  return async (row: ChatDocument): Promise<boolean> => {
    const literal = row.scope === store.scope && (row.mountPoint ?? null) === callerMount;
    if (!store.mountPointId || row.scope === 'general') return literal;
    if (row.scope === 'document_store' && row.mountPoint) {
      if (literal || row.mountPoint === store.mountPointId) return true;
      return (await storeIdForName(row.mountPoint)) === store.mountPointId;
    }
    if (row.scope === 'project') {
      return (await storeIdForChatProject(row.chatId)) === store.mountPointId;
    }
    return false;
  };
}

/**
 * Keep every `chat_documents` row still pointing at the old path (any chat's,
 * or the standalone sentinel's) in step with a move, so an open document and
 * the recent-documents list follow it instead of 404ing on the next read.
 * Rows are matched by the store they reach, not the words they were recorded
 * with, so a file opened as `project` in one chat and by store name in another
 * follows a move made through either. Best-effort: the move already landed,
 * so a tracking failure is logged and never thrown. Returns how many rows
 * moved.
 *
 * `mountPoint` is the store name the caller addressed — the resolved store's
 * name, never a caller's `self` (bug 256).
 */
export async function sweepChatDocumentsAfterMove(
  params: SweepStore & {
    oldFilePath: string;
    newFilePath: string;
    /** Defaults to the new path's basename. */
    newDisplayTitle?: string;
  },
  opts: { repos?: RepositoryContainer; logFields?: Record<string, unknown> } = {},
): Promise<number> {
  try {
    const repos = opts.repos ?? getRepositories();
    const sameStore = sameStoreMatcher(params, repos);
    const newDisplayTitle = params.newDisplayTitle ?? path.basename(params.newFilePath);
    let rowsUpdated = 0;
    for (const row of await repos.chatDocuments.findByFilePath(params.oldFilePath)) {
      if (!(await sameStore(row))) continue;
      const updated = await repos.chatDocuments.update(row.id, {
        filePath: params.newFilePath,
        displayTitle: newDisplayTitle,
      });
      if (updated) rowsUpdated++;
    }
    if (rowsUpdated > 0) {
      logger.info('Swept chat_documents after a document move', {
        ...opts.logFields,
        scope: params.scope,
        mountPoint: params.mountPoint,
        mountPointId: params.mountPointId ?? null,
        from: params.oldFilePath,
        to: params.newFilePath,
        rowsUpdated,
      });
    } else {
      logger.debug('No chat_documents rows to sweep after a document move', {
        ...opts.logFields,
        scope: params.scope,
        mountPoint: params.mountPoint,
        from: params.oldFilePath,
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

/**
 * The folder counterpart of {@link sweepChatDocumentsAfterMove}: rewrites the
 * `oldFolderPath/` prefix on every row under it that reaches the same store,
 * titling each by its new basename. Best-effort; returns how many rows moved.
 */
export async function sweepChatDocumentsAfterFolderMove(
  params: SweepStore & { oldFolderPath: string; newFolderPath: string },
  opts: { repos?: RepositoryContainer; logFields?: Record<string, unknown> } = {},
): Promise<number> {
  try {
    const repos = opts.repos ?? getRepositories();
    const sameStore = sameStoreMatcher(params, repos);
    const oldPrefix = params.oldFolderPath.endsWith('/') ? params.oldFolderPath : `${params.oldFolderPath}/`;
    const newPrefix = params.newFolderPath.endsWith('/') ? params.newFolderPath : `${params.newFolderPath}/`;
    let rowsUpdated = 0;
    for (const row of await repos.chatDocuments.findUnderFolder(params.oldFolderPath)) {
      if (!(await sameStore(row))) continue;
      const newFilePath = newPrefix + row.filePath.slice(oldPrefix.length);
      const updated = await repos.chatDocuments.update(row.id, {
        filePath: newFilePath,
        displayTitle: path.basename(newFilePath),
      });
      if (updated) rowsUpdated++;
    }
    if (rowsUpdated > 0) {
      logger.info('Swept chat_documents after a folder move', {
        ...opts.logFields,
        scope: params.scope,
        mountPoint: params.mountPoint,
        mountPointId: params.mountPointId ?? null,
        from: params.oldFolderPath,
        to: params.newFolderPath,
        rowsUpdated,
      });
    }
    return rowsUpdated;
  } catch (error) {
    logger.warn('Failed to sweep chat_documents after a folder move', {
      ...opts.logFields,
      scope: params.scope,
      mountPoint: params.mountPoint,
      from: params.oldFolderPath,
      to: params.newFolderPath,
      error: getErrorMessage(error),
    });
    return 0;
  }
}
