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
import { getErrorMessage } from '@/lib/errors';
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

function logDocumentModeSuccess(
  action: 'open' | 'read' | 'write' | 'rename' | 'delete' | 'read-missing',
  details: Record<string, unknown>
): void {
  logger.debug(`Document mode ${action}`, details);
}

// ============================================================================
// Action Handlers
// ============================================================================

/**
 * Get the active document for a chat
 */
export async function handleRecentDocuments(
  chatId: string,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    // Return all documents for the chat (active + inactive), sorted by most recent
    const allDocs = await repos.chatDocuments.findByChatId(chatId);
    const sorted = allDocs
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 10);

    return successResponse({
      documents: sorted.map(doc => ({
        id: doc.id,
        filePath: doc.filePath,
        scope: doc.scope,
        mountPoint: doc.mountPoint,
        displayTitle: doc.displayTitle,
        isActive: doc.isActive,
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

    logDocumentModeSuccess('open', {
      chatId,
      filePath,
      scope: effectiveScope,
      mode: data.mode,
      mountPoint: data.mountPoint,
      isNew: !data.filePath,
    });

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

    logDocumentModeSuccess('read', {
      chatId,
      filePath: data.filePath,
      scope: data.scope,
      mountPoint: data.mountPoint,
    });

    return successResponse({
      content: fileData.content,
      mtime: fileData.mtime,
    });
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
    const message = getErrorMessage(error);

    if (code === 'ENOENT') {
      logDocumentModeSuccess('read-missing', {
        chatId,
        filePath: data.filePath,
        scope: data.scope,
        mountPoint: data.mountPoint,
      });
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

    logDocumentModeSuccess('write', {
      chatId,
      filePath: data.filePath,
      scope: data.scope,
      mountPoint: data.mountPoint,
      hadExpectedMtime: data.mtime !== undefined,
      hasDiffContent: Boolean(data.diffContent),
    });

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

  logDocumentModeSuccess('rename', {
    chatId,
    from: doc.filePath,
    to: newFilePath,
    scope: doc.scope,
    mountPoint: doc.mountPoint,
    mountType: resolvedOld.mountType ?? 'filesystem',
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

  logDocumentModeSuccess('delete', {
    chatId,
    filePath: doc.filePath,
    scope: doc.scope,
    mountPoint: doc.mountPoint,
    mountType: resolved.mountType ?? 'filesystem',
  });

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
