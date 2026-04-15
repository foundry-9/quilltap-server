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
import { successResponse, badRequest, serverError } from '@/lib/api/responses';
import type { AuthenticatedContext } from '@/lib/api/middleware';
import {
  resolveDocEditPath,
  readFileWithMtime,
  writeFileWithMtimeCheck,
  type DocEditScope,
} from '@/lib/doc-edit';
import fs from 'fs/promises';
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
});

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
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  const body = await req.json();
  const data = openDocumentSchema.parse(body);

  // Get chat to find projectId
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return badRequest('Chat not found');
  }

  const scope = data.scope as DocEditScope;
  let filePath = data.filePath;
  let displayTitle = data.title || 'Untitled document';
  let content = '';
  let mtime: number | undefined;

  if (filePath) {
    // Opening an existing file
    try {
      const resolved = await resolveDocEditPath(scope, filePath, {
        projectId: (chat as Record<string, unknown>).projectId as string | undefined,
        mountPoint: data.mountPoint,
      });
      const fileData = await readFileWithMtime(resolved.absolutePath);
      content = fileData.content;
      mtime = fileData.mtime;
      if (!data.title) {
        displayTitle = path.basename(filePath);
      }
    } catch (error) {
      return badRequest(`File not found: ${filePath}`);
    }
  } else {
    // Creating a new blank document
    const uuid = crypto.randomUUID();
    filePath = `${uuid}.md`;
    const targetScope = (chat as Record<string, unknown>).projectId ? 'project' : 'general';

    try {
      const resolved = await resolveDocEditPath(targetScope as DocEditScope, filePath, {
        projectId: (chat as Record<string, unknown>).projectId as string | undefined,
      });
      await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
      await fs.writeFile(resolved.absolutePath, '', 'utf-8');
      const stat = await fs.stat(resolved.absolutePath);
      mtime = stat.mtimeMs;
    } catch (error) {
      return serverError(`Failed to create blank document: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Update chat_documents table
  try {
    const doc = await repos.chatDocuments.openDocument(chatId, {
      filePath,
      scope: data.scope,
      mountPoint: data.mountPoint,
      displayTitle,
    });

    // Update chat's document mode
    await repos.chats.update(chatId, {
      documentMode: data.mode,
    } as Record<string, unknown>);

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
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  const body = await req.json();
  const data = readDocumentSchema.parse(body);

  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return badRequest('Chat not found');
  }

  try {
    const resolved = await resolveDocEditPath(data.scope as DocEditScope, data.filePath, {
      projectId: (chat as Record<string, unknown>).projectId as string | undefined,
      mountPoint: data.mountPoint,
    });
    const fileData = await readFileWithMtime(resolved.absolutePath);

    return successResponse({
      content: fileData.content,
      mtime: fileData.mtime,
    });
  } catch (error) {
    return badRequest(`File not found: ${data.filePath}`);
  }
}

/**
 * Write file content from the document editor
 */
export async function handleWriteDocument(
  req: NextRequest,
  chatId: string,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  const body = await req.json();
  const data = writeDocumentSchema.parse(body);

  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return badRequest('Chat not found');
  }

  try {
    const resolved = await resolveDocEditPath(data.scope as DocEditScope, data.filePath, {
      projectId: (chat as Record<string, unknown>).projectId as string | undefined,
      mountPoint: data.mountPoint,
    });
    await fs.writeFile(resolved.absolutePath, data.content, 'utf-8');
    const stat = await fs.stat(resolved.absolutePath);

    return successResponse({
      success: true,
      mtime: stat.mtimeMs,
    });
  } catch (error) {
    logger.error('Failed to write document', {
      chatId,
      filePath: data.filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError(`Failed to write document: ${error instanceof Error ? error.message : String(error)}`);
  }
}
