/**
 * Chats API v1 - Document Mode Actions
 *
 * Handles document mode actions for Scriptorium Phase 3.5:
 * - active-document: Get the active document for a chat
 * - open-document: Open a document alongside the chat
 * - close-document: Close the document pane
 * - read-document: Read file content for the document editor
 * - write-document: Write file content from the document editor
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { successResponse, badRequest, conflict, notFound, serverError } from '@/lib/api/responses';
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
  postLibrarianOpenAnnouncement,
  postLibrarianSaveAnnouncement,
} from '@/lib/services/librarian-notifications/writer';
import { getErrorMessage } from '@/lib/errors';
import path from 'path';

// ============================================================================
// Schemas
// ============================================================================

const openDocumentSchema = z.object({
  filePath: z.string().optional(),
  title: z.string().optional(),
  scope: z.enum(['project', 'document_store', 'general']).default('project'),
  mountPoint: z.string().optional(),
  mode: z.enum(['split', 'focus']).default('split'),
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
  let displayTitle = data.title || 'Untitled document';
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
      if (!data.title) {
        displayTitle = path.basename(filePath);
      }
    } catch {
      return badRequest(`File not found: ${filePath}`);
    }
  } else {
    filePath = `${crypto.randomUUID()}.md`;

    try {
      const resolvedRequest = await resolveDocumentRequest(chatContext, {
        scope: effectiveScope,
        filePath,
        mountPoint: data.mountPoint,
      });

      const writeResult = await writeFileWithMtimeCheck(resolvedRequest.resolved, '');
      mtime = writeResult.mtime;
    } catch (error) {
      return serverError(`Failed to create blank document: ${error instanceof Error ? error.message : String(error)}`);
    }
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

    logger.debug('Opened document in chat document mode', {
      chatId,
      filePath,
      scope: effectiveScope,
      mode: data.mode,
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

    logger.debug('Read document for document mode', {
      chatId,
      filePath: data.filePath,
      scope: data.scope,
    });

    return successResponse({
      content: fileData.content,
      mtime: fileData.mtime,
    });
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
    const message = getErrorMessage(error);

    if (code === 'ENOENT') {
      logger.debug('Document not found on disk', { chatId, filePath: data.filePath, scope: data.scope });
      return notFound(`File not found: ${data.filePath}`);
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

    logger.debug('Saved document from document mode', {
      chatId,
      filePath: data.filePath,
      scope: data.scope,
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
