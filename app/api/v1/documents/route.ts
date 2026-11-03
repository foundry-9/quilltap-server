/**
 * Documents API v1 — Standalone (chat-less) Document Mode
 *
 * The left rail's Document Mode: open, read, write, rename, and delete
 * documents with no chat attached. Drives the same document core
 * (`lib/documents/core`, through `lib/documents/operator-doc-actions`) and the
 * same HTTP mapping (`lib/documents/operator-doc-http`) as the chat-scoped
 * document actions, but creates no
 * chat_documents rows for a chat and posts no Librarian announcements — there
 * is no conversation to notify.
 *
 * GET  /api/v1/documents?action=accessible-stores - every enabled store (always "look everywhere")
 * POST /api/v1/documents?action=recent-documents  - recently-opened documents across all chats
 * POST /api/v1/documents?action=open-document     - read a document, or create a blank one
 * POST /api/v1/documents?action=read-document     - read file content for the editor
 * POST /api/v1/documents?action=write-document    - write file content (mtime-checked)
 * POST /api/v1/documents?action=rename-document   - rename the underlying file
 * POST /api/v1/documents?action=delete-document   - delete the underlying file
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { createContextHandler, type RequestContext } from '@/lib/api/middleware';
import { withCollectionActionDispatch } from '@/lib/api/middleware/actions';
import { successResponse, serverError, errorResponse } from '@/lib/api/responses';
import type { DocEditScope } from '@/lib/doc-edit';
import {
  STANDALONE_ACCESS_CONTEXT,
  listAllEnabledStores,
  resolveGeneralLibrary,
} from '@/lib/documents/operator-doc-actions';
import { sweepChatDocumentsAfterMove } from '@/lib/documents/core';
import {
  documentTargetFields,
  openDocumentFields,
  writeDocumentFields,
  resolveDocumentForRoute,
  openDocumentResponse,
  openedDocumentPayload,
  readDocumentResponse,
  writeDocumentResponse,
  resolveRenameTarget,
  renameDocumentResponse,
  deleteDocumentResponse,
  dedupeRecentDocuments,
  recentDocumentsResponse,
  type DocumentHttpLog,
} from '@/lib/documents/operator-doc-http';
import { getErrorMessage } from '@/lib/error-utils';
import { MAX_RECENT_DOCUMENTS, STANDALONE_CHAT_ID } from '@/lib/chat-documents/constants';

// ============================================================================
// Schemas
// ============================================================================

// No chat means no project context, so the legacy on-disk `project` scope is
// unresolvable here. Project files remain reachable through their project's
// official document store (`document_store` scope by mount name).
const standaloneScopeSchema = z.enum(['document_store', 'general']).default('general');

const openDocumentSchema = z.object(openDocumentFields(standaloneScopeSchema));

const readDocumentSchema = z.object(documentTargetFields(standaloneScopeSchema));

const writeDocumentSchema = z.object(writeDocumentFields(standaloneScopeSchema));

const renameDocumentSchema = z.object({
  ...documentTargetFields(standaloneScopeSchema),
  newTitle: z.string().min(1),
});

const deleteDocumentSchema = z.object(documentTargetFields(standaloneScopeSchema));

/** How this route's log lines name the file. No chat to attribute them to. */
const STANDALONE_LOG: DocumentHttpLog = { subject: 'standalone document' };

// ============================================================================
// Handlers
// ============================================================================

/**
 * Every enabled store — the standalone picker is always in "look everywhere"
 * mode, since with no chat there is no narrower reach to default to. No
 * `projectLibrary` either (that button is the chat picker's project shortcut);
 * project-official mounts appear in the store accordions like any other store.
 * Quilltap General is `generalLibrary`, the "General library" button, and is
 * held back from the accordions.
 */
async function handleAccessibleStores(
  _req: NextRequest,
  { repos }: RequestContext,
): Promise<NextResponse> {
  try {
    const generalLibrary = await resolveGeneralLibrary(repos);
    const stores = await listAllEnabledStores(repos, {
      exclude: new Set(generalLibrary ? [generalLibrary.mountPointId] : []),
    });
    return successResponse({ stores, projectLibrary: null, generalLibrary });
  } catch (error) {
    logger.error('Failed to resolve stores for standalone document picker', {
      error: getErrorMessage(error),
    });
    return serverError('Failed to resolve accessible document stores');
  }
}

/**
 * Recently-opened documents across every chat (each open persists as a
 * chat_documents row). Project-scoped rows are filtered out — the standalone
 * surface has no project context to resolve them against.
 */
async function handleRecentDocuments(
  _req: NextRequest,
  { repos }: RequestContext,
): Promise<NextResponse> {
  try {
    const fetchLimit = Math.max(MAX_RECENT_DOCUMENTS * 5, 50);
    const globalRecent = await repos.chatDocuments.findRecentAcrossChats(fetchLimit);

    // already newest-first
    const ordered = dedupeRecentDocuments(
      globalRecent.filter(doc => doc.scope !== 'project'),
      MAX_RECENT_DOCUMENTS,
    );

    return recentDocumentsResponse(ordered, null);
  } catch (error) {
    logger.error('Failed to get recent documents for standalone picker', {
      error: getErrorMessage(error),
    });
    return serverError('Failed to get recent documents');
  }
}

/**
 * Open a document standalone: read an existing file, or create a blank
 * "Untitled Document.md" when no `filePath` is given. The open is recorded as a
 * `chat_documents` row under the reserved {@link STANDALONE_CHAT_ID} sentinel so
 * it joins the cross-chat recent-documents history the picker reads — the left
 * rail's Document Mode has no conversation to attach the row to. No Librarian
 * announcement is posted (there is no chat to notify).
 */
async function handleOpenDocument(
  req: NextRequest,
  { repos }: RequestContext,
): Promise<NextResponse> {
  const body = await req.json();
  const data = openDocumentSchema.parse(body);

  const result = await openDocumentResponse(STANDALONE_ACCESS_CONTEXT, {
    filePath: data.filePath,
    title: data.title,
    scope: data.scope as DocEditScope,
    mountPoint: data.mountPoint,
    targetFolder: data.targetFolder,
  }, STANDALONE_LOG);
  if (!result.ok) {
    return result.response;
  }
  const { opened } = result;

  // Record the open in recent-documents history. Failing to track must not
  // sink the open itself, so log and continue if the write throws.
  try {
    await repos.chatDocuments.openDocument(STANDALONE_CHAT_ID, {
      filePath: opened.filePath,
      scope: data.scope,
      mountPoint: data.mountPoint ?? null,
      displayTitle: opened.displayTitle,
    });
  } catch (trackError) {
    logger.warn('Failed to record standalone document in recent history', {
      filePath: opened.filePath,
      scope: data.scope,
      mountPoint: data.mountPoint,
      error: getErrorMessage(trackError),
    });
  }

  return successResponse({
    ...openedDocumentPayload(opened, {
      filePath: opened.filePath,
      scope: data.scope,
      mountPoint: data.mountPoint ?? null,
      displayTitle: opened.displayTitle,
    }),
    isNew: opened.isNew,
  });
}

/** Read file content for the standalone editor. */
async function handleReadDocument(
  req: NextRequest,
  _ctx: RequestContext,
): Promise<NextResponse> {
  const body = await req.json();
  const data = readDocumentSchema.parse(body);

  return readDocumentResponse(
    STANDALONE_ACCESS_CONTEXT,
    { scope: data.scope as DocEditScope, filePath: data.filePath, mountPoint: data.mountPoint },
    STANDALONE_LOG,
  );
}

/** Write file content from the standalone editor (mtime-checked, no Librarian). */
async function handleWriteDocument(
  req: NextRequest,
  _ctx: RequestContext,
): Promise<NextResponse> {
  const body = await req.json();
  const data = writeDocumentSchema.parse(body);

  const written = await writeDocumentResponse(
    STANDALONE_ACCESS_CONTEXT,
    {
      filePath: data.filePath,
      scope: data.scope as DocEditScope,
      mountPoint: data.mountPoint,
      content: data.content,
      mtime: data.mtime,
    },
    STANDALONE_LOG,
  );
  if (!written.ok) {
    return written.response;
  }

  return successResponse({ success: true, mtime: written.mtime });
}

/**
 * Rename a standalone document's underlying file. Same basename semantics as
 * the chat route: the new title keeps the directory, inherits the old
 * extension when none is typed, and may not contain path separators.
 */
async function handleRenameDocument(
  req: NextRequest,
  { repos }: RequestContext,
): Promise<NextResponse> {
  const body = await req.json();
  const data = renameDocumentSchema.parse(body);

  const renameTarget = resolveRenameTarget(data.filePath, data.newTitle);
  if (!renameTarget.ok) {
    return renameTarget.response;
  }
  const { newFilePath, newDisplayTitle } = renameTarget;

  if (renameTarget.unchanged) {
    return successResponse({
      document: {
        filePath: data.filePath,
        scope: data.scope,
        mountPoint: data.mountPoint ?? null,
        displayTitle: newDisplayTitle,
      },
    });
  }

  const target = { scope: data.scope as DocEditScope, mountPoint: data.mountPoint, filePath: data.filePath };
  const resolution = await resolveDocumentForRoute(STANDALONE_ACCESS_CONTEXT, target, STANDALONE_LOG, 'rename');
  if (!resolution.ok) {
    return resolution.response;
  }

  const renamed = await renameDocumentResponse(
    STANDALONE_ACCESS_CONTEXT,
    resolution.resolved,
    { scope: target.scope, mountPoint: target.mountPoint, oldFilePath: target.filePath, newFilePath },
    STANDALONE_LOG,
  );
  if (!renamed.ok) {
    return renamed.response;
  }

  // Keep the recent-documents history pointing at the new name.
  await sweepChatDocumentsAfterMove(
    {
      scope: data.scope,
      mountPoint: data.mountPoint,
      mountPointId: resolution.resolved.mountPointId,
      oldFilePath: data.filePath,
      newFilePath,
      newDisplayTitle,
    },
    { repos },
  );

  return successResponse({
    document: {
      filePath: newFilePath,
      scope: data.scope,
      mountPoint: data.mountPoint ?? null,
      displayTitle: newDisplayTitle,
    },
  });
}

/** Delete a standalone document's underlying file. */
async function handleDeleteDocument(
  req: NextRequest,
  _ctx: RequestContext,
): Promise<NextResponse> {
  const body = await req.json();
  const data = deleteDocumentSchema.parse(body);

  const target = { scope: data.scope as DocEditScope, mountPoint: data.mountPoint, filePath: data.filePath };
  const resolution = await resolveDocumentForRoute(STANDALONE_ACCESS_CONTEXT, target, STANDALONE_LOG, 'delete');
  if (!resolution.ok) {
    return resolution.response;
  }

  const deleted = await deleteDocumentResponse(resolution.resolved, target, STANDALONE_LOG);
  if (!deleted.ok) {
    return deleted.response;
  }

  return successResponse({ success: true });
}

// ============================================================================
// Route exports
// ============================================================================

export const GET = createContextHandler(
  withCollectionActionDispatch({
    'accessible-stores': handleAccessibleStores,
  })
);

export const POST = createContextHandler(
  withCollectionActionDispatch({
    'recent-documents': handleRecentDocuments,
    'open-document': handleOpenDocument,
    'read-document': handleReadDocument,
    'write-document': handleWriteDocument,
    'rename-document': handleRenameDocument,
    'delete-document': handleDeleteDocument,
  })
);
