/**
 * Chats API v1 - Document Mode Actions
 *
 * Handles document mode actions for Scriptorium Phase 3.5:
 * - active-document: Get the active document for a chat
 * - open-document: Open a document alongside the chat
 * - close-document: Close the document pane
 * - read-document: Read file content for the document editor
 * - write-document: Write file content from the document editor
 * - rename-document: Rename the active document's file (filesystem or database-backed)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { successResponse, badRequest, conflict, notFound, serverError, errorResponse } from '@/lib/api/responses';
import type { AuthenticatedContext } from '@/lib/api/middleware';
import {
  resolveDocEditPath,
  readFileWithMtime,
  writeFileWithMtimeCheck,
  reindexSingleFile,
  type DocEditScope,
} from '@/lib/doc-edit';
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler';
import {
  moveDatabaseDocument,
  deleteDatabaseDocument,
  readDatabaseDocument,
  DatabaseStoreError,
} from '@/lib/mount-index/database-store';
import {
  postLibrarianOpenAnnouncement,
  postLibrarianRenameAnnouncement,
  postLibrarianSaveAnnouncement,
  postLibrarianDeleteAnnouncement,
} from '@/lib/services/librarian-notifications/writer';
import { getErrorMessage } from '@/lib/error-utils';
import { getCharacterVaultStore } from '@/lib/file-storage/character-vault-bridge';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import { MAX_RECENT_DOCUMENTS } from '@/lib/chat-documents/constants';
import type { ChatDocument } from '@/lib/schemas/chat-document.types';
import path from 'path';
import fs from 'fs/promises';

// ============================================================================
// Schemas
// ============================================================================

const openDocumentSchema = z.object({
  filePath: z.string().optional(),
  title: z.string().optional(),
  scope: z.enum(['project', 'document_store', 'general']).default('project'),
  mountPoint: z.string().optional(),
  mode: z.enum(['split', 'focus']).default('split'),
  /**
   * Folder (relative to scope root) where a new blank document should land.
   * Forward-slash separated; ignored when `filePath` is provided. Empty/unset
   * means scope root.
   */
  targetFolder: z.string().optional(),
});

const readDocumentSchema = z.object({
  filePath: z.string(),
  scope: z.enum(['project', 'document_store', 'general']).default('project'),
  mountPoint: z.string().optional(),
});

const writeDocumentSchema = z.object({
  filePath: z.string(),
  scope: z.enum(['project', 'document_store', 'general']).default('project'),
  mountPoint: z.string().optional(),
  content: z.string(),
  mtime: z.number().optional(),
  /** Pre-formatted diff content from the client; when present, a Librarian save announcement is posted */
  diffContent: z.string().optional(),
});

const renameDocumentSchema = z.object({
  newTitle: z.string().min(1),
});

function getProjectId(chat: unknown): string | undefined {
  return (chat as Record<string, unknown>).projectId as string | undefined;
}

function getParticipantCharacterIds(chat: unknown): string[] {
  const participants = (chat as { participants?: Array<{ characterId?: string | null }> }).participants;
  if (!Array.isArray(participants)) return [];
  const ids = new Set<string>();
  for (const p of participants) {
    if (p?.characterId) ids.add(p.characterId);
  }
  return Array.from(ids);
}

interface ChatDocumentContext {
  projectId?: string;
  characterIds: string[];
}

async function getChatContext(
  chatId: string,
  { repos }: AuthenticatedContext
): Promise<ChatDocumentContext | null> {
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return null;
  }

  return {
    projectId: getProjectId(chat),
    characterIds: getParticipantCharacterIds(chat),
  };
}

async function resolveDocumentRequest(
  chatContext: ChatDocumentContext,
  params: {
    scope: DocEditScope;
    filePath: string;
    mountPoint?: string;
  }
): Promise<{ projectId?: string; resolved: Awaited<ReturnType<typeof resolveDocEditPath>> }> {
  const resolved = await resolveDocEditPath(params.scope, params.filePath, {
    projectId: chatContext.projectId,
    characterIds: chatContext.characterIds,
    mountPoint: params.mountPoint,
    // These are operator-driven Document Mode actions (open/read/write/rename/
    // delete from the Salon UI), so the operator may reach any enabled store —
    // including ones picked via the picker's "look everywhere" mode. Character
    // doc tools use a separate code path and never get this override.
    operatorOverride: true,
  });

  return {
    ...chatContext,
    resolved,
  };
}

/**
 * Probe whether a resolved doc-edit path currently has a file. Database-backed
 * stores answer via readDatabaseDocument (NOT_FOUND → false); filesystem
 * scopes use fs.access. Any other error bubbles, since we don't want to
 * silently treat permission failures as "doesn't exist" and overwrite.
 */
async function resolvedPathExists(
  resolved: Awaited<ReturnType<typeof resolveDocEditPath>>
): Promise<boolean> {
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

  try {
    await fs.access(resolved.absolutePath);
    return true;
  } catch (error) {
    const code = error instanceof Error && 'code' in error
      ? (error as NodeJS.ErrnoException).code
      : undefined;
    if (code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Pick an unused "Untitled Document.md" filename inside `targetFolder`.
 * On collision, appends a counter ("Untitled Document 2.md", etc.). Returns
 * both the relative file path (for the chat_documents row and rename math)
 * and the resolved path it lives at (so the caller can write without a
 * second resolution round-trip).
 */
async function pickUntitledDocumentPath(
  chatContext: ChatDocumentContext,
  scope: DocEditScope,
  mountPoint: string | undefined,
  targetFolder: string | undefined,
): Promise<{ filePath: string; resolved: Awaited<ReturnType<typeof resolveDocEditPath>> }> {
  const folder = (targetFolder ?? '').replace(/^\/+|\/+$/g, '');
  const join = (name: string) => (folder ? `${folder}/${name}` : name);
  const MAX_ATTEMPTS = 1000;

  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const candidate = i === 1 ? 'Untitled Document.md' : `Untitled Document ${i}.md`;
    const filePath = join(candidate);
    const { resolved } = await resolveDocumentRequest(chatContext, {
      scope,
      filePath,
      mountPoint,
    });
    if (!(await resolvedPathExists(resolved))) {
      return { filePath, resolved };
    }
  }

  // Defensive: if a thousand "Untitled Document N.md" already exist, fall
  // back to a UUID so the user can still create a new doc.
  const filePath = join(`Untitled Document ${crypto.randomUUID()}.md`);
  const { resolved } = await resolveDocumentRequest(chatContext, {
    scope,
    filePath,
    mountPoint,
  });
  return { filePath, resolved };
}

function scheduleDocumentStoreRefresh(
  mountPointId: string,
  relativePath: string,
  absolutePath: string,
  repos: AuthenticatedContext['repos'],
  filePath: string,
): void {
  reindexSingleFile(mountPointId, relativePath, absolutePath)
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

// ============================================================================
// Action Handlers
// ============================================================================

/**
 * Recent documents for the Open-Document picker.
 *
 * Starts with the current chat's documents, then folds in recently-opened
 * documents from other chats (every opened doc persists as a chat_documents
 * row, so this is durable across chats). The list is deduped by file identity
 * — current-chat rows win the dedupe so a file touched in this chat keeps its
 * "this chat first" placement — and capped at MAX_RECENT_DOCUMENTS.
 */
export async function handleRecentDocuments(
  chatId: string,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    // This chat's own documents (always shown first, in full) plus a window of
    // the most-recently-updated documents from every other chat. Fetching the
    // current chat separately guarantees its docs lead even when other chats
    // have churned past the global window.
    const fetchLimit = Math.max(MAX_RECENT_DOCUMENTS * 5, 50);
    const [thisChatDocs, globalRecent] = await Promise.all([
      repos.chatDocuments.findByChatId(chatId),
      repos.chatDocuments.findRecentAcrossChats(fetchLimit),
    ]);

    const byUpdatedDesc = (a: ChatDocument, b: ChatDocument) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    const thisChat = [...thisChatDocs].sort(byUpdatedDesc);
    const otherChats = globalRecent.filter(doc => doc.chatId !== chatId); // already newest-first

    // Dedupe over the concatenation (this-chat ahead of others) so a file opened
    // in both this chat and elsewhere keeps its "this chat first" placement.
    const seen = new Set<string>();
    const ordered: ChatDocument[] = [];
    for (const doc of [...thisChat, ...otherChats]) {
      const key = `${doc.scope} ${doc.mountPoint ?? ''} ${doc.filePath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push(doc);
      if (ordered.length >= MAX_RECENT_DOCUMENTS) break;
    }

    const thisChatReturned = ordered.filter(doc => doc.chatId === chatId).length;
    logger.debug('Resolved recent documents for picker', {
      chatId,
      thisChatTotal: thisChat.length,
      otherChatsWindow: otherChats.length,
      returned: ordered.length,
      fromThisChat: thisChatReturned,
      fromOtherChats: ordered.length - thisChatReturned,
    });

    return successResponse({
      documents: ordered.map(doc => ({
        id: doc.id,
        chatId: doc.chatId,
        filePath: doc.filePath,
        scope: doc.scope,
        mountPoint: doc.mountPoint,
        displayTitle: doc.displayTitle,
        // "Continue editing" only makes sense for the doc active in THIS chat;
        // an other-chat row is offered as a fresh "Reopen" here.
        isActive: doc.isActive && doc.chatId === chatId,
        fromCurrentChat: doc.chatId === chatId,
        updatedAt: doc.updatedAt,
      })),
    });
  } catch (error) {
    logger.error('Failed to get recent documents', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to get recent documents');
  }
}

/**
 * Kind of an accessible store, used by the picker to bucket the right-column
 * accordions. `character` → a participant's character vault; `document-store`
 * → a document store linked to the chat's project.
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
}

/**
 * The project's official document store, surfaced as the picker's left-column
 * "Project library" button so it browses and opens the same mount the
 * `project` scope resolves to. Null when the chat has no project or the project
 * has no official mount (legacy on-disk project files — the button falls back
 * to `project` scope there).
 */
export interface ProjectLibraryTarget {
  mountPointId: string;
  /** Canonical mount name — what `document_store` opens resolve against. */
  name: string;
  mountType: 'filesystem' | 'obsidian' | 'database';
}

/**
 * Document stores reachable from this chat, for the Open-Document picker's
 * right-column accordions. Mirrors `collectAccessibleMountPointIds`: every
 * participant's character vault, each document store linked to the chat's
 * project, plus the instance-wide "Quilltap General" mount (always accessible).
 * The client buckets the result by storeType/mountType into Character Vaults /
 * Database-backed / Filesystem-backed.
 *
 * Only the project's *official* mount is held back — that one is the dedicated
 * left-column "Project library" button (returned separately as `projectLibrary`
 * so the button can browse/open the real mount). Quilltap General is NOT held
 * back: the left-column "General library" button still points at the legacy
 * on-disk general store, so the Quilltap General *mount* would otherwise be
 * unreachable.
 *
 * When `opts.all` is set (the picker's "look everywhere" mode) the chat-reach
 * restriction is dropped and EVERY enabled store is returned — character vaults
 * labelled by their owning character's name — still holding back only the
 * project-official mount. The operator may open any of these because the
 * operator document actions resolve with `operatorOverride`.
 */
export async function handleAccessibleStores(
  chatId: string,
  { repos }: AuthenticatedContext,
  opts: { all?: boolean } = {}
): Promise<NextResponse> {
  try {
    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return notFound('Chat');
    }

    // The project's official mount is surfaced as the left-column "Project
    // library" button, so keep it out of the accordions to avoid duplication.
    // (Quilltap General is intentionally NOT excluded — see the doc comment.)
    const seen = new Set<string>();
    let projectLibrary: ProjectLibraryTarget | null = null;
    if (chat.projectId) {
      const project = await repos.projects.findById(chat.projectId);
      if (project?.officialMountPointId) {
        seen.add(project.officialMountPointId);
        const officialMp = await repos.docMountPoints.findById(project.officialMountPointId);
        if (officialMp?.enabled) {
          projectLibrary = {
            mountPointId: officialMp.id,
            name: officialMp.name,
            mountType: officialMp.mountType,
          };
        }
      }
    }

    const stores: AccessibleStoreOption[] = [];

    if (opts.all) {
      // "Look everywhere": every enabled store, regardless of chat reach.
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
      for (const mp of mounts) {
        if (seen.has(mp.id)) continue;
        seen.add(mp.id);
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
        });
      }
    } else {
      // Default: only stores reachable from this chat.
      // 1. Participant character vaults.
      for (const participant of chat.participants) {
        if (participant.type !== 'CHARACTER' || !participant.characterId) continue;
        if (participant.status === 'removed') continue;
        const vault = await getCharacterVaultStore(participant.characterId);
        if (!vault || seen.has(vault.mountPointId)) continue;
        const mp = await repos.docMountPoints.findById(vault.mountPointId);
        if (!mp) continue;
        const character = await repos.characters.findById(participant.characterId);
        stores.push({
          mountPointId: mp.id,
          name: mp.name,
          label: character?.name ?? mp.name,
          kind: 'character',
          mountType: mp.mountType,
          storeType: mp.storeType,
          characterId: participant.characterId,
        });
        seen.add(mp.id);
      }

      // 2. Document stores linked to the chat's project.
      if (chat.projectId) {
        const links = await repos.projectDocMountLinks.findByProjectId(chat.projectId);
        for (const link of links) {
          if (seen.has(link.mountPointId)) continue;
          const mp = await repos.docMountPoints.findById(link.mountPointId);
          if (!mp) continue;
          stores.push({
            mountPointId: mp.id,
            name: mp.name,
            label: mp.name,
            kind: 'document-store',
            mountType: mp.mountType,
            storeType: mp.storeType,
          });
          seen.add(mp.id);
        }
      }

      // 3. Quilltap General — always accessible to every chat, so it always
      // appears (under Database-backed, normally). Mirrors path-resolver.
      const generalId = await getGeneralMountPointId();
      if (generalId && !seen.has(generalId)) {
        const mp = await repos.docMountPoints.findById(generalId);
        if (mp?.enabled) {
          stores.push({
            mountPointId: mp.id,
            name: mp.name,
            label: mp.name,
            kind: 'document-store',
            mountType: mp.mountType,
            storeType: mp.storeType,
          });
          seen.add(mp.id);
        }
      }
    }

    logger.debug('Resolved accessible document stores for picker', {
      chatId,
      mode: opts.all ? 'all' : 'chat',
      total: stores.length,
      hasProjectLibrary: projectLibrary !== null,
      characterVaults: stores.filter(s => s.storeType === 'character').length,
      databaseStores: stores.filter(s => s.storeType === 'documents' && s.mountType === 'database').length,
      filesystemStores: stores.filter(s => s.storeType === 'documents' && s.mountType !== 'database').length,
    });

    return successResponse({ stores, projectLibrary });
  } catch (error) {
    logger.error('Failed to resolve accessible document stores', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to resolve accessible document stores');
  }
}

/**
 * Get the active document for a chat
 */
export async function handleActiveDocument(
  chatId: string,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const doc = await repos.chatDocuments.findActiveForChat(chatId);

    return successResponse({
      document: doc ? {
        id: doc.id,
        filePath: doc.filePath,
        scope: doc.scope,
        mountPoint: doc.mountPoint,
        displayTitle: doc.displayTitle,
      } : null,
    });
  } catch (error) {
    logger.error('Failed to get active document', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to get active document');
  }
}

/**
 * Open a document alongside the chat
 */
export async function handleOpenDocument(
  req: NextRequest,
  chatId: string,
  context: AuthenticatedContext
): Promise<NextResponse> {
  const body = await req.json();
  const data = openDocumentSchema.parse(body);

  const chatContext = await getChatContext(chatId, context);
  if (!chatContext) {
    return badRequest('Chat not found');
  }

  const { repos } = context;
  const requestedScope = data.scope as DocEditScope;
  const effectiveScope: DocEditScope = !data.filePath && requestedScope === 'project' && !chatContext.projectId
    ? 'general'
    : requestedScope;

  let filePath = data.filePath;
  let displayTitle = data.title;
  let content = '';
  let mtime: number | undefined;

  if (filePath) {
    try {
      const resolvedRequest = await resolveDocumentRequest(chatContext, {
        scope: effectiveScope,
        filePath,
        mountPoint: data.mountPoint,
      });

      const fileData = await readFileWithMtime(resolvedRequest.resolved);
      content = fileData.content;
      mtime = fileData.mtime;
      if (!displayTitle) {
        displayTitle = path.basename(filePath);
      }
    } catch {
      // 404 (not 400) so the client can distinguish a genuinely missing file
      // from a malformed request and surface a friendly toast instead of the
      // dev error overlay.
      return errorResponse(`File not found: ${filePath}`, 404);
    }
  } else {
    try {
      const picked = await pickUntitledDocumentPath(
        chatContext,
        effectiveScope,
        data.mountPoint,
        data.targetFolder,
      );
      filePath = picked.filePath;
      const writeResult = await writeFileWithMtimeCheck(picked.resolved, '');
      mtime = writeResult.mtime;
      if (!displayTitle) {
        displayTitle = path.basename(filePath);
      }
    } catch (error) {
      return serverError(`Failed to create blank document: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!displayTitle) {
    displayTitle = 'Untitled document';
  }

  try {
    const doc = await repos.chatDocuments.openDocument(chatId, {
      filePath,
      scope: effectiveScope,
      mountPoint: data.mountPoint,
      displayTitle,
    });

    await repos.chats.update(chatId, {
      documentMode: data.mode,
    } as Record<string, unknown>);


    const librarianMessage = await postLibrarianOpenAnnouncement({
      chatId,
      displayTitle,
      filePath,
      scope: effectiveScope,
      mountPoint: data.mountPoint,
      isNew: !data.filePath,
      origin: { kind: 'opened-by-user' },
    });

    return successResponse({
      document: {
        id: doc.id,
        filePath: doc.filePath,
        scope: doc.scope,
        mountPoint: doc.mountPoint,
        displayTitle: doc.displayTitle,
      },
      content,
      mtime,
      librarianMessage: librarianMessage ?? null,
    });
  } catch (error) {
    logger.error('Failed to open document', {
      chatId,
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to open document');
  }
}

/**
 * Close the document pane
 */
export async function handleCloseDocument(
  chatId: string,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    await repos.chatDocuments.closeDocument(chatId);
    await repos.chats.update(chatId, {
      documentMode: 'normal',
    } as Record<string, unknown>);

    return successResponse({ success: true });
  } catch (error) {
    logger.error('Failed to close document', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to close document');
  }
}

/**
 * Read file content for the document editor
 */
export async function handleReadDocument(
  req: NextRequest,
  chatId: string,
  context: AuthenticatedContext
): Promise<NextResponse> {
  const body = await req.json();
  const data = readDocumentSchema.parse(body);

  const chatContext = await getChatContext(chatId, context);
  if (!chatContext) {
    return badRequest('Chat not found');
  }

  let resolvedRequest;
  try {
    resolvedRequest = await resolveDocumentRequest(chatContext, {
      scope: data.scope as DocEditScope,
      filePath: data.filePath,
      mountPoint: data.mountPoint,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    logger.warn('Failed to resolve document path for read', {
      chatId,
      filePath: data.filePath,
      scope: data.scope,
      mountPoint: data.mountPoint,
      error: message,
    });
    return badRequest(`Could not resolve ${data.filePath}: ${message}`);
  }

  try {
    const fileData = await readFileWithMtime(resolvedRequest.resolved);

    return successResponse({
      content: fileData.content,
      mtime: fileData.mtime,
    });
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
    const message = getErrorMessage(error);

    if (code === 'ENOENT') {
      // notFound() appends "not found" to its argument, which would produce
      // "File not found: X not found" — use errorResponse so the client sees
      // the same shape as open-document's missing-file response.
      return errorResponse(`File not found: ${data.filePath}`, 404);
    }

    logger.error('Failed to read document', {
      chatId,
      filePath: data.filePath,
      scope: data.scope,
      code,
      error: message,
    });
    return serverError(`Failed to read document: ${message}`);
  }
}

/**
 * Write file content from the document editor
 */
export async function handleWriteDocument(
  req: NextRequest,
  chatId: string,
  context: AuthenticatedContext
): Promise<NextResponse> {
  const body = await req.json();
  const data = writeDocumentSchema.parse(body);

  const chatContext = await getChatContext(chatId, context);
  if (!chatContext) {
    return badRequest('Chat not found');
  }

  try {
    const resolvedRequest = await resolveDocumentRequest(chatContext, {
      scope: data.scope as DocEditScope,
      filePath: data.filePath,
      mountPoint: data.mountPoint,
    });

    const { repos } = context;
    const { resolved } = resolvedRequest;
    const { mtime } = await writeFileWithMtimeCheck(
      resolved,
      data.content,
      data.mtime,
    );

    if (data.scope === 'document_store' && resolved.mountPointId) {
      scheduleDocumentStoreRefresh(
        resolved.mountPointId,
        resolved.relativePath,
        resolved.absolutePath,
        repos,
        data.filePath,
      );
    }

    const librarianMessage = data.diffContent
      ? await postLibrarianSaveAnnouncement({ chatId, diffContent: data.diffContent })
      : null;

    return successResponse({
      success: true,
      mtime,
      librarianMessage: librarianMessage ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('mtime mismatch') || message.includes('modified by another process')) {
      logger.warn('Document save conflict detected', {
        chatId,
        filePath: data.filePath,
        error: message,
      });
      return conflict('Document changed elsewhere. Reload it and try again.');
    }

    logger.error('Failed to write document', {
      chatId,
      filePath: data.filePath,
      error: message,
    });
    return serverError(`Failed to write document: ${message}`);
  }
}

/**
 * Rename the active document's underlying file.
 *
 * The user types a new name in the DocumentPane title input; we treat that
 * input as the new basename (directory preserved). If the input has no
 * extension, the old extension is appended so users can type "backstory"
 * and get "backstory.md". Path separators are rejected — this is a rename
 * within the current directory, not a move.
 *
 * Dispatches on mount type so database-backed stores route through
 * moveDatabaseDocument while filesystem-backed scopes use fs.rename,
 * matching the pattern in doc_move_file.
 */
export async function handleRenameDocument(
  req: NextRequest,
  chatId: string,
  context: AuthenticatedContext
): Promise<NextResponse> {
  const body = await req.json();
  const data = renameDocumentSchema.parse(body);

  const { repos } = context;
  const doc = await repos.chatDocuments.findActiveForChat(chatId);
  if (!doc) {
    return badRequest('No active document to rename');
  }

  const raw = data.newTitle.trim();
  if (!raw) {
    return badRequest('Name cannot be empty');
  }
  if (raw.includes('/') || raw.includes('\\')) {
    return badRequest('Name cannot contain path separators');
  }
  if (raw === '.' || raw === '..' || raw.split(/[\\/]/).includes('..')) {
    return badRequest('Invalid name');
  }

  const oldExt = path.extname(doc.filePath);
  const oldDir = path.dirname(doc.filePath);
  const newBasename = path.extname(raw) ? raw : `${raw}${oldExt}`;
  const newFilePath = oldDir === '.' || oldDir === ''
    ? newBasename
    : `${oldDir.replace(/\\/g, '/')}/${newBasename}`;

  if (newFilePath === doc.filePath) {
    return successResponse({
      document: {
        id: doc.id,
        filePath: doc.filePath,
        scope: doc.scope,
        mountPoint: doc.mountPoint,
        displayTitle: doc.displayTitle,
      },
    });
  }

  const chatContext = await getChatContext(chatId, context);
  if (!chatContext) {
    return badRequest('Chat not found');
  }

  let resolvedOld, resolvedNew;
  try {
    resolvedOld = (await resolveDocumentRequest(chatContext, {
      scope: doc.scope as DocEditScope,
      filePath: doc.filePath,
      mountPoint: doc.mountPoint ?? undefined,
    })).resolved;
    resolvedNew = (await resolveDocumentRequest(chatContext, {
      scope: doc.scope as DocEditScope,
      filePath: newFilePath,
      mountPoint: doc.mountPoint ?? undefined,
    })).resolved;
  } catch (error) {
    const message = getErrorMessage(error);
    logger.warn('Failed to resolve document path for rename', {
      chatId,
      from: doc.filePath,
      to: newFilePath,
      error: message,
    });
    return badRequest(`Could not resolve path: ${message}`);
  }

  try {
    if (resolvedOld.mountType === 'database' && resolvedOld.mountPointId) {
      await moveDatabaseDocument(
        resolvedOld.mountPointId,
        resolvedOld.relativePath,
        resolvedNew.relativePath,
      );
    } else {
      try {
        await fs.access(resolvedNew.absolutePath);
        return conflict(`A file already exists at that name.`);
      } catch {
        // destination free — proceed
      }
      await fs.mkdir(path.dirname(resolvedNew.absolutePath), { recursive: true });
      await fs.rename(resolvedOld.absolutePath, resolvedNew.absolutePath);

      if (doc.scope === 'document_store' && resolvedOld.mountPointId) {
        scheduleDocumentStoreRefresh(
          resolvedOld.mountPointId,
          resolvedNew.relativePath,
          resolvedNew.absolutePath,
          repos,
          newFilePath,
        );
      }
    }
  } catch (error) {
    const message = getErrorMessage(error);
    if (error instanceof DatabaseStoreError && error.code === 'CONFLICT') {
      return conflict(`A file already exists at that name.`);
    }
    if (error instanceof DatabaseStoreError && error.code === 'UNSUPPORTED') {
      return badRequest(message);
    }
    logger.error('Failed to rename document', {
      chatId,
      from: doc.filePath,
      to: newFilePath,
      error: message,
    });
    return serverError(`Failed to rename document: ${message}`);
  }

  const newDisplayTitle = path.basename(newFilePath);
  const oldDisplayTitle = doc.displayTitle || path.basename(doc.filePath);
  const updated = await repos.chatDocuments.update(doc.id, {
    filePath: newFilePath,
    displayTitle: newDisplayTitle,
  });

  const librarianMessage = await postLibrarianRenameAnnouncement({
    chatId,
    oldDisplayTitle,
    newDisplayTitle,
    oldFilePath: doc.filePath,
    newFilePath,
    scope: doc.scope as 'project' | 'document_store' | 'general',
    mountPoint: doc.mountPoint,
  });

  const result = updated ?? doc;
  return successResponse({
    document: {
      id: result.id,
      filePath: newFilePath,
      scope: doc.scope,
      mountPoint: doc.mountPoint,
      displayTitle: newDisplayTitle,
    },
    librarianMessage: librarianMessage ?? null,
  });
}

/**
 * Delete the active document's underlying file. Database-backed stores route
 * through deleteDatabaseDocument; filesystem scopes use fs.unlink. The chat's
 * document association is deactivated (mirrors handleCloseDocument), and the
 * Librarian announces the removal so characters present know the file is gone.
 */
export async function handleDeleteDocument(
  chatId: string,
  context: AuthenticatedContext
): Promise<NextResponse> {
  const { repos } = context;
  const doc = await repos.chatDocuments.findActiveForChat(chatId);
  if (!doc) {
    return badRequest('No active document to delete');
  }

  const chatContext = await getChatContext(chatId, context);
  if (!chatContext) {
    return badRequest('Chat not found');
  }

  let resolved;
  try {
    resolved = (await resolveDocumentRequest(chatContext, {
      scope: doc.scope as DocEditScope,
      filePath: doc.filePath,
      mountPoint: doc.mountPoint ?? undefined,
    })).resolved;
  } catch (error) {
    const message = getErrorMessage(error);
    logger.warn('Failed to resolve document path for delete', {
      chatId,
      filePath: doc.filePath,
      error: message,
    });
    return badRequest(`Could not resolve path: ${message}`);
  }

  try {
    if (resolved.mountType === 'database' && resolved.mountPointId) {
      const deleted = await deleteDatabaseDocument(resolved.mountPointId, resolved.relativePath);
      if (!deleted) {
        return notFound('File not found');
      }
    } else {
      try {
        const stat = await fs.stat(resolved.absolutePath);
        if (!stat.isFile()) {
          return badRequest(`Path is not a file: ${doc.filePath}`);
        }
      } catch {
        return notFound('File not found');
      }
      await fs.unlink(resolved.absolutePath);
    }
  } catch (error) {
    const message = getErrorMessage(error);
    logger.error('Failed to delete document', {
      chatId,
      filePath: doc.filePath,
      error: message,
    });
    return serverError(`Failed to delete document: ${message}`);
  }

  await repos.chatDocuments.closeDocument(chatId);
  await repos.chats.update(chatId, {
    documentMode: 'normal',
  } as Record<string, unknown>);

  const displayTitle = doc.displayTitle || path.basename(doc.filePath);

  const librarianMessage = await postLibrarianDeleteAnnouncement({
    chatId,
    displayTitle,
    filePath: doc.filePath,
    scope: doc.scope as 'project' | 'document_store' | 'general',
    mountPoint: doc.mountPoint,
    origin: { kind: 'by-user' },
  });

  return successResponse({
    success: true,
    librarianMessage: librarianMessage ?? null,
  });
}
