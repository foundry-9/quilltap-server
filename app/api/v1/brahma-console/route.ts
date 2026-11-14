/**
 * Brahma Console API v1 - Collection Endpoint
 *
 * GET  /api/v1/brahma-console                         - List the user's Brahma Console chats
 * POST /api/v1/brahma-console                         - Create a new Brahma Console chat
 * POST /api/v1/brahma-console?action=upload           - Store an attachment under Brahma/ in Quilltap General
 * POST /api/v1/brahma-console?action=discard-upload   - Remove an attachment dropped before sending
 *
 * The Brahma Console is a character-less, memory-free generic-LLM surface, so
 * there is no eligibility action — the only precondition is "at least one
 * connection profile exists", which the provider checks via the connections
 * query directly.
 *
 * Uploads are not bound to a chat: a launcher upload happens before the chat
 * exists. An upload abandoned without sending or discarding stays in
 * `Brahma/`, an ordinary General document the operator can remove.
 */

import { NextRequest } from 'next/server';
import { createContextHandler, withCollectionActionDispatch, type RequestContext } from '@/lib/api/middleware';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { z } from 'zod';
import { badRequest, created, serverError, successResponse } from '@/lib/api/responses';
import { byChatActivityDesc } from '@/lib/chat/chat-activity';
import { ConsoleContextRefSchema, ConsoleModeEnum } from '@/lib/schemas/chat.types';
import { dedupeContextRefs } from '@/lib/brahma-console/writing-context';
import {
  collectAttachmentIds,
  discardConsoleAttachment,
  findConsoleAttachmentLink,
  storeConsoleAttachment,
} from '@/lib/brahma-console/attachments';
import { validateChatFile } from '@/lib/chat-files-v2';
import { getErrorMessage } from '@/lib/error-utils';
import { validateConsoleContextRefs } from './_shared';

const logger = createServiceLogger('BrahmaConsoleRoute');

// ============================================================================
// Schemas
// ============================================================================

const createBrahmaChatSchema = z
  .object({
    /** Connection profile (model) to start on. Defaults to the user's default profile. */
    connectionProfileId: z.string().uuid().optional(),
    /** `'writing'` opens a Writing Assistant conversation; fixed for its life. */
    mode: ConsoleModeEnum.optional(),
    /** Writing Assistant sources; only with `mode: 'writing'`. */
    context: z.array(ConsoleContextRefSchema).max(200).optional(),
  })
  .strict();

const discardUploadSchema = z.object({ fileId: z.string().uuid() }).strict();

// ============================================================================
// Handler Functions
// ============================================================================

/**
 * List the user's Brahma Console chats (most-recent first).
 */
async function handleList(_req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  const allChats = await repos.chats.findByUserId(user.id);
  const brahmaChats = allChats
    .filter((c) => c.chatType === 'brahma')
    .sort(byChatActivityDesc);

  const enrichedChats = await Promise.all(
    brahmaChats.map(async (chat) => {
      const messages = await repos.chats.getMessages(chat.id);
      return {
        id: chat.id,
        title: chat.title,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        lastMessageAt: chat.lastMessageAt ?? null,
        messageCount: messages.length,
        consoleConnectionProfileId: chat.consoleConnectionProfileId ?? null,
        consoleMode: chat.consoleMode ?? null,
        attachmentCount: collectAttachmentIds(messages).length,
      };
    })
  );

  return successResponse({ chats: enrichedChats });
}

/**
 * Create a new Brahma Console chat.
 */
async function handleCreate(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  const body = await req.json().catch(() => ({}));
  const validatedData = createBrahmaChatSchema.parse(body ?? {});

  if (validatedData.context && validatedData.mode !== 'writing') {
    return badRequest('A context is only for a Writing Assistant conversation');
  }
  const contextRefs = validatedData.context ? dedupeContextRefs(validatedData.context) : [];
  const contextProblem = await validateConsoleContextRefs(contextRefs, context);
  if (contextProblem) return badRequest(contextProblem);

  // Resolve the starting connection profile: the one requested, else the
  // user's default profile.
  let profileId = validatedData.connectionProfileId ?? null;
  if (profileId) {
    const profile = await repos.connections.findById(profileId);
    if (!profile || profile.userId !== user.id) {
      return badRequest('Connection profile not found');
    }
  } else {
    const defaultProfile = await repos.connections.findDefault(user.id);
    if (!defaultProfile) {
      return badRequest('No connection profile available — establish one before opening the Console.');
    }
    profileId = defaultProfile.id;
  }

  const writing = validatedData.mode === 'writing';
  const chat = await repos.chats.create({
    userId: user.id,
    participants: [],
    title: writing ? 'A Fresh Sheet at the Writing Desk' : 'A Fresh Audience at the Console',
    chatType: 'brahma',
    consoleConnectionProfileId: profileId,
    ...(writing ? { consoleMode: 'writing' as const, consoleContext: contextRefs } : {}),
  });

  logger.info('Brahma Console chat created', {
    chatId: chat.id,
    userId: user.id,
    connectionProfileId: profileId,
    consoleMode: writing ? 'writing' : null,
    contextRefs: contextRefs.length,
  });

  return created({ chat });
}

/**
 * Store one attachment (FormData `file`) under `Brahma/` in Quilltap General.
 */
async function handleUpload(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  const formData = await req.formData();
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return badRequest('No file provided');
  }

  try {
    validateChatFile(file);
  } catch (error) {
    return badRequest(getErrorMessage(error));
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const attachment = await storeConsoleAttachment({
      bytes,
      filename: file.name,
      mimeType: file.type,
      userId: user.id,
      repos,
    });
    logger.debug('Console upload stored', { linkId: attachment.id, path: attachment.path, size: attachment.size });
    return created(attachment);
  } catch (error) {
    logger.error('Console upload failed', { filename: file.name, error: getErrorMessage(error) });
    return serverError('The attachment could not be stored');
  }
}

/**
 * Remove an upload the operator dropped from the composer before sending.
 * Only a file still directly under `Brahma/` in General is removed.
 */
async function handleDiscardUpload(req: NextRequest, context: RequestContext) {
  const { repos } = context;
  const { fileId } = discardUploadSchema.parse(await req.json());

  const link = await findConsoleAttachmentLink(fileId, repos);
  if (!link) {
    // Already gone, or moved somewhere the operator chose: nothing to do.
    return successResponse({ outcome: 'missing' as const });
  }
  const outcome = await discardConsoleAttachment(fileId, repos);
  logger.debug('Console upload discarded', { fileId, outcome });
  return successResponse({ outcome });
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * GET /api/v1/brahma-console
 */
export const GET = createContextHandler(async (req, context) => {
  return handleList(req, context);
});

/**
 * POST /api/v1/brahma-console[?action=upload|discard-upload]
 */
export const POST = createContextHandler(
  withCollectionActionDispatch(
    {
      upload: handleUpload,
      'discard-upload': handleDiscardUpload,
    },
    handleCreate
  )
);
