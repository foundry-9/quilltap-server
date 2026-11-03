/**
 * Operator Document Actions
 *
 * What is the operator's own in Document Mode: access contexts, path
 * resolution with the operator override, blank-document naming, the open
 * and editor-write compositions, qtap:// target classification, and store
 * listing. Every file-level job (read, write, rename, delete, create, view
 * classification) is the document core's (`lib/documents/core`), which the
 * `doc_*` tools drive too. Two routes drive this module:
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
  isTextFile,
  type DocEditScope,
  type ResolvedPath,
} from '@/lib/doc-edit';
import { mimeForExtension } from '@/lib/mount-index/path-utils';
import { getErrorMessage } from '@/lib/error-utils';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { DocumentViewTarget } from '@/lib/folder-browser/document-actions';
import type { ChatMetadata } from '@/lib/schemas/types';
import type { DocMountPoint } from '@/lib/schemas/mount-index.types';
import {
  documentExists,
  ensureDocument,
  readDocument,
  viewTargetFor,
  writeDocument,
  DocumentConflictError,
  DocumentMissingError,
  DocumentReadOnlyError,
} from './core';
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

export { DocumentConflictError, DocumentMissingError, DocumentReadOnlyError } from './core';

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
    if (!(await documentExists(resolved))) {
      return { filePath, resolved };
    }
  }

  // Defensive: if a thousand "Untitled Document N.md" already exist, fall
  // back to a UUID so the user can still create a new doc.
  const filePath = join(`Untitled Document ${crypto.randomUUID()}.md`);
  const resolved = await resolveOperatorDocPath(ctx, { scope, filePath, mountPoint });
  return { filePath, resolved };
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

/**
 * The file half of opening a document: read an existing file (or, for a file
 * Document Mode only views, its view target), or pick an unused "Untitled
 * Document.md" name and create it blank. Throws {@link DocumentMissingError}
 * when a named file can't be read.
 */
export async function openDocumentFile(
  ctx: DocumentAccessContext,
  params: OpenDocumentFileParams,
): Promise<OpenedDocumentFile> {
  if (params.filePath) {
    const displayTitle = params.title || path.basename(params.filePath);
    try {
      const resolved = await resolveOperatorDocPath(ctx, {
        scope: params.scope,
        filePath: params.filePath,
        mountPoint: params.mountPoint,
      });
      const viewer = await viewTargetFor(resolved);
      if (viewer) {
        logger.debug('openDocumentFile: opening read-only', { filePath: params.filePath, mountPointId: viewer.mountPointId });
        return { filePath: params.filePath, displayTitle, content: '', isNew: false, viewer };
      }
      const { content, mtime } = await readDocument(resolved);
      return { filePath: params.filePath, displayTitle, content, mtime, isNew: false };
    } catch (error) {
      logger.debug('openDocumentFile: file not readable', {
        filePath: params.filePath,
        scope: params.scope,
        mountPoint: params.mountPoint,
        error: getErrorMessage(error),
      });
      throw new DocumentMissingError(`File not found: ${params.filePath}`);
    }
  }

  const picked = await pickUntitledDocumentPath(
    ctx,
    params.scope,
    params.mountPoint,
    params.targetFolder,
  );
  const ensured = await ensureDocument(picked.resolved);
  if (!ensured.created) {
    // The name was free a moment ago; something else took it.
    throw new DocumentConflictError('A file already exists at that name.');
  }
  return {
    filePath: picked.filePath,
    displayTitle: params.title || path.basename(picked.filePath),
    content: '',
    mtime: ensured.mtime,
    isNew: true,
  };
}

/**
 * Write a document from the editor: resolve with the operator override,
 * refuse a file Document Mode only views ({@link DocumentReadOnlyError}),
 * then the core's {@link writeDocument} (mtime-checked, refreshed). A stale
 * mtime surfaces as a {@link DocumentConflictError} for the route to map.
 */
export async function writeDocumentFile(
  ctx: DocumentAccessContext,
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

  if (await viewTargetFor(resolved)) {
    throw new DocumentReadOnlyError(`${params.filePath} is shown read-only and cannot be written from the editor`);
  }

  return writeDocument(resolved, params.content, params.mtime);
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
 * One picker row for a store. Labelled by the owning character's name when
 * `owner` is given (a vault), else by the store's own name.
 */
export function storeOptionFor(
  mp: Pick<DocMountPoint, 'id' | 'name' | 'mountType' | 'storeType'>,
  kind: AccessibleStoreKind,
  extra: { owner?: { id: string; name?: string | null }; isGroupStore?: boolean } = {},
): AccessibleStoreOption {
  return {
    mountPointId: mp.id,
    name: mp.name,
    label: extra.owner?.name ?? mp.name,
    kind,
    mountType: mp.mountType,
    storeType: mp.storeType,
    ...(extra.owner ? { characterId: extra.owner.id } : {}),
    ...(extra.isGroupStore ? { isGroupStore: true } : {}),
  };
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
    stores.push(storeOptionFor(mp, isCharacter ? 'character' : 'document-store', {
      owner,
      isGroupStore: groupMountIds.has(mp.id),
    }));
  }
  return stores;
}
