/**
 * Operator Document Actions — shared core
 *
 * Chat-agnostic mechanics behind Document Mode's operator actions: path
 * resolution (with the operator override), existence probing, blank-document
 * naming, read/write with mtime conflict detection, rename/delete file
 * mechanics, and store listing. Two routes drive this core:
 *
 * - `/api/v1/chats/[id]?action=…-document` — the chat-scoped route, which adds
 *   chat_documents row tracking and Librarian announcements on top.
 * - `/api/v1/documents?action=…` — the chat-less standalone route (the left
 *   rail's Document Mode), which uses the core directly: no chat rows, no
 *   Librarian, nobody to announce to.
 *
 * @module lib/documents/operator-doc-actions
 */

import { logger } from '@/lib/logger';
import {
  resolveDocEditPath,
  readFileWithMtime,
  writeFileWithMtimeCheck,
  reindexSingleFile,
  statResolvedFile,
  moveResolvedFile,
  deleteResolvedFile,
  isTextFile,
  type DocEditScope,
  type ResolvedPath,
} from '@/lib/doc-edit';
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler';
import { detectNativeText, mimeForExtension } from '@/lib/mount-index/path-utils';
import {
  moveDatabaseDocument,
  deleteDatabaseDocument,
  readDatabaseDocument,
  readDatabaseBlobForDocument,
  DatabaseStoreError,
} from '@/lib/mount-index/database-store';
import { getErrorMessage } from '@/lib/error-utils';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import { getRepositories, type RepositoryContainer } from '@/lib/repositories/factory';
import type { DocumentViewTarget } from '@/lib/folder-browser/document-actions';
import type { ChatMetadata } from '@/lib/schemas/types';
import path from 'path';

/**
 * Who is reaching for documents: the chat route fills this from the chat's
 * project and character participants; the standalone route passes an empty
 * context (no project, no characters) and relies on the operator override.
 */
export interface DocumentAccessContext {
  projectId?: string;
  characterIds: string[];
}

/** An access context with nothing behind it — the standalone (chat-less) caller. */
export const STANDALONE_ACCESS_CONTEXT: DocumentAccessContext = Object.freeze({
  projectId: undefined,
  characterIds: [],
});

/**
 * The access context a chat's Document Mode resolves against: the chat's
 * project plus every character participant (deduped). The chat-scoped document
 * actions and the qtap:// target stream both derive it from the same row.
 */
export function documentAccessContextForChat(
  chat: Pick<ChatMetadata, 'projectId' | 'participants'>,
): DocumentAccessContext {
  const characterIds = new Set<string>();
  // A partially-hydrated row (fixtures, older callers) may lack the array.
  const participants = Array.isArray(chat.participants) ? chat.participants : [];
  for (const participant of participants) {
    if (participant?.characterId) characterIds.add(participant.characterId);
  }
  return { projectId: chat.projectId ?? undefined, characterIds: Array.from(characterIds) };
}

/**
 * The document changed underneath the caller: a rename/create target already
 * exists, or a write's mtime precondition failed because the file was edited
 * elsewhere since it was read. Routes map it to a 409.
 */
export class DocumentConflictError extends Error {}

/** The requested document does not exist. */
export class DocumentMissingError extends Error {}

/**
 * Resolve a document path for an operator-driven Document Mode action
 * (open/read/write/rename/delete from the UI). The operator may reach any
 * enabled store — including ones picked via the picker's "look everywhere"
 * mode and the chat-less standalone surface. Character doc tools use a
 * separate code path and never get this override.
 */
export async function resolveOperatorDocPath(
  ctx: DocumentAccessContext,
  params: {
    scope: DocEditScope;
    filePath: string;
    mountPoint?: string;
    /** Resolves the reserved `self` mount token to this character's vault. */
    characterId?: string;
  },
): Promise<ResolvedPath> {
  return resolveDocEditPath(params.scope, params.filePath, {
    projectId: ctx.projectId,
    characterIds: ctx.characterIds,
    characterId: params.characterId,
    mountPoint: params.mountPoint,
    operatorOverride: true,
  });
}

/**
 * Probe whether a resolved doc-edit path currently has a file. Database-backed
 * stores answer via readDatabaseDocument (NOT_FOUND → false); filesystem
 * scopes stat the disk. Any other error bubbles, since we don't want to
 * silently treat permission failures as "doesn't exist" and overwrite.
 */
export async function resolvedPathExists(resolved: ResolvedPath): Promise<boolean> {
  if (resolved.mountType === 'database') {
    if (!resolved.mountPointId) {
      throw new Error('Database-backed ResolvedPath is missing mountPointId');
    }
    try {
      await readDatabaseDocument(resolved.mountPointId, resolved.relativePath);
      return true;
    } catch (error) {
      if (error instanceof DatabaseStoreError && error.code === 'NOT_FOUND') {
        return false;
      }
      throw error;
    }
  }

  return (await statResolvedFile(resolved)) !== null;
}

/** Classify a resolved target for qtap:// link gating: document, image, or other. */
export async function classifyResolvedTarget(
  repos: RepositoryContainer,
  resolved: ResolvedPath,
): Promise<'document' | 'image' | 'other'> {
  if (isTextFile(resolved.relativePath)) {
    return 'document';
  }

  const extensionMime = mimeForExtension(resolved.relativePath);
  if (extensionMime.startsWith('image/')) {
    return 'image';
  }

  if (resolved.mountType === 'database' && resolved.mountPointId) {
    const link = await repos.docMountFileLinks.findByMountPointAndPath(
      resolved.mountPointId,
      resolved.relativePath,
    );
    if (link?.fileType === 'blob') {
      const blob = await repos.docMountBlobs.findByFileId(link.fileId);
      if (blob?.storedMimeType?.startsWith('image/')) {
        return 'image';
      }
    }
  }

  return 'other';
}

/**
 * Pick an unused "Untitled Document.md" filename inside `targetFolder`.
 * On collision, appends a counter ("Untitled Document 2.md", etc.). Returns
 * both the relative file path (for tracking rows and rename math) and the
 * resolved path it lives at (so the caller can write without a second
 * resolution round-trip).
 */
export async function pickUntitledDocumentPath(
  ctx: DocumentAccessContext,
  scope: DocEditScope,
  mountPoint: string | undefined,
  targetFolder: string | undefined,
): Promise<{ filePath: string; resolved: ResolvedPath }> {
  const folder = (targetFolder ?? '').replace(/^\/+|\/+$/g, '');
  const join = (name: string) => (folder ? `${folder}/${name}` : name);
  const MAX_ATTEMPTS = 1000;

  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const candidate = i === 1 ? 'Untitled Document.md' : `Untitled Document ${i}.md`;
    const filePath = join(candidate);
    const resolved = await resolveOperatorDocPath(ctx, { scope, filePath, mountPoint });
    if (!(await resolvedPathExists(resolved))) {
      return { filePath, resolved };
    }
  }

  // Defensive: if a thousand "Untitled Document N.md" already exist, fall
  // back to a UUID so the user can still create a new doc.
  const filePath = join(`Untitled Document ${crypto.randomUUID()}.md`);
  const resolved = await resolveOperatorDocPath(ctx, { scope, filePath, mountPoint });
  return { filePath, resolved };
}

/**
 * Fire-and-forget re-index (with hard-link siblings) + embedding + stats
 * refresh after a store write. Callers gate on the resolved path's
 * `mountPointId`, never on its scope: a `project`-scope path into a project's
 * official store needs the same pass (#133).
 */
export function scheduleDocumentStoreRefresh(
  mountPointId: string,
  relativePath: string,
  absolutePath: string,
  repos: RepositoryContainer,
  filePath: string,
): void {
  reindexSingleFile(mountPointId, relativePath, absolutePath)
    // Hard-linked siblings share these bytes and need their own chunk sets
    // rebuilt, as `doc_*` tool writes already do.
    .then(async () => {
      const { reindexLinkGroupSiblings } = await import('@/lib/mount-index/link-groups');
      await reindexLinkGroupSiblings(mountPointId, relativePath);
    })
    .then(() => Promise.all([
      enqueueEmbeddingJobsForMountPoint(mountPointId),
      repos.docMountPoints.refreshStats(mountPointId),
    ]))
    .catch(err => {
      logger.warn('Background re-index, embedding, or stats refresh failed after document save', {
        path: filePath,
        error: getErrorMessage(err),
      });
    });
}

export interface OpenDocumentFileParams {
  filePath?: string;
  title?: string;
  scope: DocEditScope;
  mountPoint?: string;
  /** Folder (relative to scope root) for a new blank document; ignored when `filePath` is set. */
  targetFolder?: string;
}

export interface OpenedDocumentFile {
  filePath: string;
  displayTitle: string;
  content: string;
  mtime?: number;
  /** True when a new blank document was created (no `filePath` was given). */
  isNew: boolean;
  /** Set for a file shown read-only (not text); `content` is then empty. */
  viewer?: DocumentViewTarget;
}

/** Thrown when an editor write targets a file Document Mode only views. */
export class DocumentReadOnlyError extends Error {}

/**
 * Whether a resolved document is one Document Mode shows read-only rather
 * than edits: any file in a document store that is not a text file. Its
 * bytes are never read as text — the viewer fetches them itself, and no
 * model is handed them through Document Mode. Null for a text file, for a
 * file outside a store (the legacy project and general areas, which the
 * viewer cannot address), and for a store file that does not exist.
 */
export async function documentViewTargetFor(resolved: ResolvedPath): Promise<DocumentViewTarget | null> {
  if (!resolved.mountPointId) return null;
  // A database store saves only native text (.md, .txt, .json, .jsonl), so
  // any other text kind there (.yaml, .html, …) is shown, not edited.
  const editable = resolved.mountType === 'database'
    ? !!detectNativeText(resolved.relativePath)
    : isTextFile(resolved.relativePath);
  if (editable) return null;
  const link = await getRepositories().docMountFileLinks.findByMountPointAndPath(
    resolved.mountPointId,
    resolved.relativePath,
  );
  if (link) {
    return {
      mountPointId: resolved.mountPointId,
      relativePath: link.relativePath,
      fileName: link.fileName,
      fileType: link.fileType,
      fileSizeBytes: link.fileSizeBytes,
      originalMimeType: link.originalMimeType ?? null,
      updatedAt: link.updatedAt,
    };
  }
  if (resolved.mountType === 'database' || !resolved.absolutePath) return null;
  // A file on disk the store does not index (its kind is outside the
  // include patterns) is still there to look at.
  const stat = await statResolvedFile(resolved);
  if (!stat || !stat.isFile) return null;
  return {
    mountPointId: resolved.mountPointId,
    relativePath: resolved.relativePath,
    fileName: path.basename(resolved.relativePath),
    fileType: 'blob',
    fileSizeBytes: stat.size,
    originalMimeType: null,
    updatedAt: stat.mtime.toISOString(),
  };
}

/**
 * Read a file the editor can open. An upload in a database store is a blob,
 * not a document, so when no document is there the blob is read through
 * {@link readDatabaseBlobForDocument} — the same reader `doc_read_file` uses
 * (#134); the first save turns it into a document. Throws ENOENT as
 * {@link readFileWithMtime} does when neither is there.
 */
export async function readEditableDocument(
  resolved: ResolvedPath,
): Promise<{ content: string; mtime: number; size: number }> {
  try {
    return await readFileWithMtime(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (resolved.mountType !== 'database' || !resolved.mountPointId) throw error;
    const blob = await readDatabaseBlobForDocument(resolved.mountPointId, resolved.relativePath);
    if (!blob) throw error;
    return { content: blob.content, mtime: blob.mtime, size: blob.size };
  }
}

/**
 * The file half of opening a document: read an existing file, or pick an
 * unused "Untitled Document.md" name and create it blank. Throws
 * {@link DocumentMissingError} when a named file can't be read.
 */
export async function openDocumentFile(
  ctx: DocumentAccessContext,
  params: OpenDocumentFileParams,
): Promise<OpenedDocumentFile> {
  if (params.filePath) {
    let content: string;
    let mtime: number | undefined;
    try {
      const resolved = await resolveOperatorDocPath(ctx, {
        scope: params.scope,
        filePath: params.filePath,
        mountPoint: params.mountPoint,
      });
      const viewer = await documentViewTargetFor(resolved);
      if (viewer) {
        logger.debug('openDocumentFile: opening read-only', { filePath: params.filePath, mountPointId: viewer.mountPointId });
        return {
          filePath: params.filePath,
          displayTitle: params.title || path.basename(params.filePath),
          content: '',
          isNew: false,
          viewer,
        };
      }
      const fileData = await readEditableDocument(resolved);
      content = fileData.content;
      mtime = fileData.mtime;
    } catch (error) {
      logger.debug('openDocumentFile: file not readable', {
        filePath: params.filePath,
        scope: params.scope,
        mountPoint: params.mountPoint,
        error: getErrorMessage(error),
      });
      throw new DocumentMissingError(`File not found: ${params.filePath}`);
    }
    return {
      filePath: params.filePath,
      displayTitle: params.title || path.basename(params.filePath),
      content,
      mtime,
      isNew: false,
    };
  }

  const picked = await pickUntitledDocumentPath(
    ctx,
    params.scope,
    params.mountPoint,
    params.targetFolder,
  );
  const writeResult = await writeFileWithMtimeCheck(picked.resolved, '');
  return {
    filePath: picked.filePath,
    displayTitle: params.title || path.basename(picked.filePath),
    content: '',
    mtime: writeResult.mtime,
    isNew: true,
  };
}

/**
 * The mtime precondition failure as minted by the three store writers
 * (`writeFileWithMtimeCheck` on disk, the database store, the mount-index
 * file store) — recognised by message, since two of them throw plain Errors.
 */
function isMtimeConflict(error: unknown): boolean {
  const message = getErrorMessage(error);
  return message.includes('mtime mismatch') || message.includes('modified by another process');
}

/**
 * Write a document's content with mtime conflict detection, scheduling the
 * store re-index whenever the path lands in a store (#133). An mtime mismatch from
 * {@link writeFileWithMtimeCheck} surfaces as a {@link DocumentConflictError}
 * (keeping the writer's own message) for the route to map to a 409.
 */
export async function writeDocumentFile(
  ctx: DocumentAccessContext,
  repos: RepositoryContainer,
  params: {
    filePath: string;
    scope: DocEditScope;
    mountPoint?: string;
    content: string;
    mtime?: number;
  },
): Promise<{ mtime: number }> {
  const resolved = await resolveOperatorDocPath(ctx, {
    scope: params.scope,
    filePath: params.filePath,
    mountPoint: params.mountPoint,
  });

  if (await documentViewTargetFor(resolved)) {
    throw new DocumentReadOnlyError(`${params.filePath} is shown read-only and cannot be written from the editor`);
  }

  let mtime: number;
  try {
    ({ mtime } = await writeFileWithMtimeCheck(resolved, params.content, params.mtime));
  } catch (error) {
    if (isMtimeConflict(error)) {
      logger.debug('writeDocumentFile: mtime conflict', {
        filePath: params.filePath,
        scope: params.scope,
        mountPoint: params.mountPoint,
        error: getErrorMessage(error),
      });
      throw new DocumentConflictError(getErrorMessage(error));
    }
    throw error;
  }

  if (resolved.mountPointId) {
    scheduleDocumentStoreRefresh(
      resolved.mountPointId,
      resolved.relativePath,
      resolved.absolutePath,
      repos,
      params.filePath,
    );
  }

  return { mtime };
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
 * Move a document's underlying file to its rename target. Dispatches on mount
 * type: database-backed stores route through moveDatabaseDocument while
 * filesystem-backed scopes use moveResolvedFile (matching the pattern in
 * doc_move_file). Throws {@link DocumentConflictError} when the destination is
 * taken; DatabaseStoreError UNSUPPORTED bubbles for the route to map.
 */
export async function renameDocumentFile(
  ctx: DocumentAccessContext,
  repos: RepositoryContainer,
  params: {
    scope: DocEditScope;
    mountPoint?: string;
    oldFilePath: string;
    newFilePath: string;
  },
): Promise<void> {
  const resolvedOld = await resolveOperatorDocPath(ctx, {
    scope: params.scope,
    filePath: params.oldFilePath,
    mountPoint: params.mountPoint,
  });
  const resolvedNew = await resolveOperatorDocPath(ctx, {
    scope: params.scope,
    filePath: params.newFilePath,
    mountPoint: params.mountPoint,
  });

  if (resolvedOld.mountType === 'database' && resolvedOld.mountPointId) {
    try {
      await moveDatabaseDocument(
        resolvedOld.mountPointId,
        resolvedOld.relativePath,
        resolvedNew.relativePath,
      );
    } catch (error) {
      if (error instanceof DatabaseStoreError && error.code === 'CONFLICT') {
        throw new DocumentConflictError('A file already exists at that name.');
      }
      throw error;
    }
    return;
  }

  if (await statResolvedFile(resolvedNew)) {
    throw new DocumentConflictError('A file already exists at that name.');
  }
  await moveResolvedFile(resolvedOld, resolvedNew);

  if (resolvedNew.mountPointId) {
    scheduleDocumentStoreRefresh(
      resolvedNew.mountPointId,
      resolvedNew.relativePath,
      resolvedNew.absolutePath,
      repos,
      params.newFilePath,
    );
  }
}

/**
 * Delete a document's underlying file. Database-backed stores route through
 * deleteDatabaseDocument; filesystem scopes use deleteResolvedFile. Returns a status
 * for the route to map ('not-found' → 404, 'not-a-file' → 400).
 */
export async function deleteDocumentFile(
  ctx: DocumentAccessContext,
  params: {
    scope: DocEditScope;
    mountPoint?: string;
    filePath: string;
  },
): Promise<'deleted' | 'not-found' | 'not-a-file'> {
  const resolved = await resolveOperatorDocPath(ctx, {
    scope: params.scope,
    filePath: params.filePath,
    mountPoint: params.mountPoint,
  });

  if (resolved.mountType === 'database' && resolved.mountPointId) {
    const deleted = await deleteDatabaseDocument(resolved.mountPointId, resolved.relativePath);
    return deleted ? 'deleted' : 'not-found';
  }

  const stat = await statResolvedFile(resolved);
  if (!stat) return 'not-found';
  if (!stat.isFile) return 'not-a-file';
  await deleteResolvedFile(resolved);
  return 'deleted';
}

/**
 * Kind of an accessible store, used by the picker to bucket the right-column
 * accordions. `character` → a character vault; `document-store` → any other
 * document store.
 */
export type AccessibleStoreKind = 'character' | 'document-store';

export interface AccessibleStoreOption {
  /** Mount point UUID — used to list files (`/api/v1/mount-points/:id/files`). */
  mountPointId: string;
  /**
   * The mount point's canonical name. This is what document opens resolve
   * against (`resolveDocEditPath` matches `document_store` scope by name), so
   * it must be the real mount name, not a display alias.
   */
  name: string;
  /** Display label for the row — character name for vaults, store name otherwise. */
  label: string;
  kind: AccessibleStoreKind;
  mountType: 'filesystem' | 'obsidian' | 'database';
  storeType: 'documents' | 'character';
  /** Present for `kind: 'character'`. */
  characterId?: string;
  /**
   * True when this store is reachable via a group membership of some character
   * participant. The picker buckets these into a dedicated "Group Files"
   * accordion. Only the chat route can know this — the standalone route never
   * sets it.
   */
  isGroupStore?: boolean;
}

/** A store the picker reaches from a left-column button (Project library, General library). */
export interface LibraryTarget {
  mountPointId: string;
  /** Canonical mount name — what `document_store` opens resolve against. */
  name: string;
  mountType: 'filesystem' | 'obsidian' | 'database';
}

/**
 * Quilltap General, the instance-wide store behind the picker's "General
 * library" button. Null when it is not provisioned or is disabled.
 */
export async function resolveGeneralLibrary(repos: RepositoryContainer): Promise<LibraryTarget | null> {
  const generalId = await getGeneralMountPointId();
  if (!generalId) return null;
  const mp = await repos.docMountPoints.findById(generalId);
  if (!mp?.enabled) {
    logger.debug('resolveGeneralLibrary: Quilltap General is missing or disabled', { generalId });
    return null;
  }
  return { mountPointId: mp.id, name: mp.name, mountType: mp.mountType };
}

/**
 * Every enabled store — the "look everywhere" listing. Character vaults are
 * labelled by their owning character's name. `exclude` holds back stores the
 * caller surfaces elsewhere (the chat route's project-official mount);
 * `groupMountIds` lets the chat route tag its reachable group stores.
 */
export async function listAllEnabledStores(
  repos: RepositoryContainer,
  opts: { exclude?: Set<string>; groupMountIds?: Set<string> } = {},
): Promise<AccessibleStoreOption[]> {
  const exclude = opts.exclude ?? new Set<string>();
  const groupMountIds = opts.groupMountIds ?? new Set<string>();

  const [mounts, characters] = await Promise.all([
    repos.docMountPoints.findEnabled(),
    repos.characters.findAll(),
  ]);
  // Reverse-map character vaults to their owning character for labelling.
  const vaultOwner = new Map<string, { id: string; name: string }>();
  for (const c of characters) {
    if (c.characterDocumentMountPointId) {
      vaultOwner.set(c.characterDocumentMountPointId, { id: c.id, name: c.name });
    }
  }

  const stores: AccessibleStoreOption[] = [];
  for (const mp of mounts) {
    if (exclude.has(mp.id)) continue;
    exclude.add(mp.id);
    const isCharacter = mp.storeType === 'character';
    const owner = isCharacter ? vaultOwner.get(mp.id) : undefined;
    stores.push({
      mountPointId: mp.id,
      name: mp.name,
      label: owner?.name ?? mp.name,
      kind: isCharacter ? 'character' : 'document-store',
      mountType: mp.mountType,
      storeType: mp.storeType,
      ...(owner ? { characterId: owner.id } : {}),
      ...(groupMountIds.has(mp.id) ? { isGroupStore: true } : {}),
    });
  }
  return stores;
}
