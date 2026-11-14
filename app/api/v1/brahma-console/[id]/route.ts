/**
 * Brahma Console API v1 - Individual Endpoint
 *
 * GET    /api/v1/brahma-console/[id]                     - Get chat details (mode, resolved context)
 * PATCH  /api/v1/brahma-console/[id]                     - Rename
 * PATCH  /api/v1/brahma-console/[id]?action=set-model    - Switch model (same chat continues)
 * PATCH  /api/v1/brahma-console/[id]?action=set-context  - Replace a Writing Assistant conversation's context
 * POST   /api/v1/brahma-console/[id]?action=save-output  - Save a Writing Assistant output to a store
 * DELETE /api/v1/brahma-console/[id]                     - Delete (with its attachments under Brahma/)
 *
 * No update-context action: the Brahma Console is not page-aware. The mode
 * (`consoleMode`) is set at creation and never changed by any route.
 */

import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, type RequestContext } from '@/lib/api/middleware';
import { dispatchAction } from '@/lib/api/middleware/actions';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { z } from 'zod';
import type { ChatMetadata } from '@/lib/schemas/types';
import { ConsoleContextRefSchema } from '@/lib/schemas/chat.types';
import { badRequest, conflict, notFound, serverError, successResponse } from '@/lib/api/responses';
import { resolveConsoleContext, dedupeContextRefs } from '@/lib/brahma-console/writing-context';
import { WRITING_OUTPUT_KIND } from '@/lib/brahma-console/writing-output';
import { deleteConsoleAttachmentsForChat } from '@/lib/brahma-console/attachments';
import { sanitizeLeafName } from '@/lib/file-storage/bridge-path-helpers';
import { resolveInsideSync } from '@/lib/paths/resolve-inside';
import { resolveOperatorDocPath, STANDALONE_ACCESS_CONTEXT } from '@/lib/documents/operator-doc-actions';
import { ensureDocument, writeDocument } from '@/lib/documents/core';
import { docStoreUriFor } from '@/lib/doc-edit/uri-producers';
import { getErrorMessage } from '@/lib/error-utils';
import { verifyBrahmaChat, validateConsoleContextRefs } from '../_shared';

const logger = createServiceLogger('BrahmaConsoleItemRoute');


// ============================================================================
// Schemas
// ============================================================================

const renameSchema = z.object({
  title: z.string().min(1, 'Title is required'),
});

const setModelSchema = z.object({
  connectionProfileId: z.string().uuid('A connection profile id is required'),
});

const setContextSchema = z
  .object({
    context: z.array(ConsoleContextRefSchema).max(200),
  })
  .strict();

const saveOutputSchema = z
  .object({
    messageId: z.string().min(1),
    mountPointId: z.string().uuid(),
    /** Folder inside the store; '' is the top. */
    folderPath: z.string().max(1000).default(''),
    filename: z.string().min(1).max(255),
    onConflict: z.enum(['fail', 'overwrite']).optional(),
  })
  .strict();

// ============================================================================
// Handler Functions
// ============================================================================

async function handleGet(
  _req: NextRequest,
  context: RequestContext,
  id: string
): Promise<NextResponse> {
  const { user, repos } = context;

  const result = await verifyBrahmaChat(id, context);
  if (result instanceof NextResponse) return result;
  const { chat } = result;

  const messages = await repos.chats.getMessages(id);
  const writing = chat.consoleMode === 'writing';

  return successResponse({
    chat: {
      id: chat.id,
      title: chat.title,
      chatType: chat.chatType,
      consoleConnectionProfileId: chat.consoleConnectionProfileId ?? null,
      consoleMode: chat.consoleMode ?? null,
      // Resolved here so the client renders chips from one read and never
      // resolves names itself.
      context: writing ? await resolveConsoleContext(repos, user.id, chat.consoleContext) : null,
      contextRefs: writing ? (chat.consoleContext ?? []) : null,
      messageCount: messages.length,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      lastMessageAt: chat.lastMessageAt ?? null,
    },
  });
}

async function handleRename(
  req: NextRequest,
  context: RequestContext,
  id: string
): Promise<NextResponse> {
  const { repos } = context;

  const result = await verifyBrahmaChat(id, context);
  if (result instanceof NextResponse) return result;

  const body = await req.json();
  const validatedData = renameSchema.parse(body);

  const updated = await repos.chats.update(id, {
    title: validatedData.title,
    isManuallyRenamed: true,
  });

  if (!updated) {
    return serverError('Failed to rename Brahma Console chat');
  }

  logger.info('Brahma Console chat renamed', { chatId: id, title: validatedData.title });

  return successResponse({ chat: updated });
}

/**
 * Switch the model for this Brahma chat. The same conversation continues; the
 * new model applies from the next turn forward.
 */
async function handleSetModel(
  req: NextRequest,
  context: RequestContext,
  id: string
): Promise<NextResponse> {
  const { user, repos } = context;

  const result = await verifyBrahmaChat(id, context);
  if (result instanceof NextResponse) return result;

  const body = await req.json();
  const { connectionProfileId } = setModelSchema.parse(body);

  // The profile must exist and belong to this user.
  const profile = await repos.connections.findById(connectionProfileId);
  if (!profile || profile.userId !== user.id) {
    return badRequest('Connection profile not found');
  }

  const updated = await repos.chats.update(id, {
    consoleConnectionProfileId: connectionProfileId,
  } as Partial<ChatMetadata>);

  if (!updated) {
    return serverError('Failed to switch the Console model');
  }

  logger.info('Brahma Console model switched', { chatId: id, connectionProfileId });

  return successResponse({ chat: updated });
}

/**
 * Replace a Writing Assistant conversation's context (whole list). Applies
 * from the next turn. Refused on an ordinary Console chat.
 */
async function handleSetContext(
  req: NextRequest,
  context: RequestContext,
  id: string
): Promise<NextResponse> {
  const { user, repos } = context;

  const result = await verifyBrahmaChat(id, context);
  if (result instanceof NextResponse) return result;
  const { chat } = result;

  if (chat.consoleMode !== 'writing') {
    return badRequest('Only a Writing Assistant conversation has a context');
  }

  const { context: rawRefs } = setContextSchema.parse(await req.json());
  const refs = dedupeContextRefs(rawRefs);
  const problem = await validateConsoleContextRefs(refs, context);
  if (problem) return badRequest(problem);

  const updated = await repos.chats.update(id, { consoleContext: refs } as Partial<ChatMetadata>);
  if (!updated) {
    return serverError('Failed to update the Writing Assistant context');
  }

  logger.info('Writing Assistant context replaced', { chatId: id, refs: refs.length });

  return successResponse({
    contextRefs: refs,
    context: await resolveConsoleContext(repos, user.id, refs),
  });
}

/**
 * Save one Writing Assistant output to a document store. The server reads the
 * content from the stored message; the client never sends the text. An
 * operator action, not a tool call, so the read ceiling does not apply.
 */
async function handleSaveOutput(
  req: NextRequest,
  context: RequestContext,
  id: string
): Promise<NextResponse> {
  const { repos } = context;

  const result = await verifyBrahmaChat(id, context);
  if (result instanceof NextResponse) return result;

  const body = saveOutputSchema.parse(await req.json());

  const messages = await repos.chats.getMessages(id);
  const message = messages.find(
    (m): m is Extract<typeof m, { type: 'message' }> => m.type === 'message' && m.id === body.messageId
  );
  if (!message) return notFound('Console message');
  if (message.systemKind !== WRITING_OUTPUT_KIND) {
    return badRequest('That message is not a Writing Assistant output');
  }

  const store = await repos.docMountPoints.findById(body.mountPointId);
  if (!store || store.enabled === false) {
    return badRequest('Document store not found');
  }

  // One safe leaf name, always .md; the folder and name resolved inside the
  // store's root — never a string check.
  let filename = sanitizeLeafName(body.filename);
  if (!/\.md$/i.test(filename)) filename = `${filename.replace(/\.markdown$/i, '')}.md`;
  const folder = body.folderPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  let relativePath: string;
  try {
    const absolute = resolveInsideSync('/store-root', path.posix.join(folder, filename), { allowBase: false });
    relativePath = path.relative('/store-root', absolute).split(path.sep).join('/');
  } catch {
    return badRequest('That folder path leaves the store');
  }

  let resolved;
  try {
    resolved = await resolveOperatorDocPath(STANDALONE_ACCESS_CONTEXT, {
      scope: 'document_store',
      mountPoint: store.name,
      filePath: relativePath,
    });
  } catch (error) {
    logger.warn('save-output: destination did not resolve', {
      chatId: id,
      mountPointId: store.id,
      relativePath,
      error: getErrorMessage(error),
    });
    return badRequest(getErrorMessage(error, 'That destination is not available'));
  }

  const address = await docStoreUriFor({
    mountPointId: store.id,
    mountPointName: store.name,
    relativePath,
  });

  try {
    const ensured = await ensureDocument(resolved);
    if (!ensured.created && body.onConflict !== 'overwrite') {
      logger.debug('save-output: destination exists', { chatId: id, mountPointId: store.id, relativePath });
      return conflict(`A file already exists at ${relativePath}`);
    }
    await writeDocument(resolved, message.content);
  } catch (error) {
    logger.error('save-output: write failed', {
      chatId: id,
      mountPointId: store.id,
      relativePath,
      error: getErrorMessage(error),
    });
    return serverError('The piece could not be saved');
  }

  logger.info('Writing Assistant output saved', {
    chatId: id,
    messageId: message.id,
    mountPointId: store.id,
    relativePath,
  });

  return successResponse({
    saved: true,
    mountPointId: store.id,
    storeName: store.name,
    path: relativePath,
    address,
  });
}

async function handleDelete(
  _req: NextRequest,
  context: RequestContext,
  id: string
): Promise<NextResponse> {
  const { repos } = context;

  const result = await verifyBrahmaChat(id, context);
  if (result instanceof NextResponse) return result;

  // Attachments still under Brahma/ in General go with the conversation;
  // moved ones are kept. (`chats.delete` sweeps too, for every other path
  // that deletes a Brahma chat; by then this has left it nothing to do.)
  const attachments = await deleteConsoleAttachmentsForChat(repos, id);

  const deleted = await repos.chats.delete(id);
  if (!deleted) {
    return serverError('Failed to delete Brahma Console chat');
  }

  logger.info('Brahma Console chat deleted', { chatId: id, attachmentsDeleted: attachments.deleted, attachmentsKept: attachments.kept });

  return successResponse({
    message: 'Brahma Console chat deleted successfully',
    attachmentsDeleted: attachments.deleted,
    attachmentsKept: attachments.kept,
  });
}

// ============================================================================
// Route Handlers
// ============================================================================

export const GET = createContextParamsHandler<{ id: string }>(
  async (req, context, { id }) => {
    return handleGet(req, context, id);
  }
);

export const PATCH = createContextParamsHandler<{ id: string }>(
  async (req, context, { id }) =>
    dispatchAction(
      req,
      {
        'set-model': () => handleSetModel(req, context, id),
        'set-context': () => handleSetContext(req, context, id),
      },
      () => handleRename(req, context, id)
    )
);

export const POST = createContextParamsHandler<{ id: string }>(
  async (req, context, { id }) =>
    dispatchAction(req, { 'save-output': () => handleSaveOutput(req, context, id) })
);

export const DELETE = createContextParamsHandler<{ id: string }>(
  async (req, context, { id }) => {
    return handleDelete(req, context, id);
  }
);
