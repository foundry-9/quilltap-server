/**
 * Calliope API v1 - Collection Endpoint
 *
 * GET  /api/v1/calliope?draftId=<id>             - List the conversations about a theme draft
 * POST /api/v1/calliope                          - Open a conversation about a theme draft
 * POST /api/v1/calliope?action=upload            - Store a reference picture under Calliope/ in Quilltap General
 * POST /api/v1/calliope?action=discard-upload    - Remove an upload dropped before sending
 *
 * Calliope is a character-less, memory-free console about one theme draft
 * (Calliope Live, Spec J). A conversation belongs to its draft and is deleted
 * with it. Uploads are not bound to a conversation (one may be made before it
 * exists); an abandoned one stays in `Calliope/`, an ordinary General document.
 */

import { NextRequest } from 'next/server';
import { createContextHandler, withCollectionActionDispatch, type RequestContext } from '@/lib/api/middleware';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { z } from 'zod';
import { badRequest, created, notFound, serverError, successResponse } from '@/lib/api/responses';
import { byChatActivityDesc } from '@/lib/chat/chat-activity';
import {
  collectAttachmentIds,
  discardConsoleAttachment,
  findConsoleAttachmentLink,
  storeConsoleAttachment,
} from '@/lib/console-engine/attachments';
import { CALLIOPE_ATTACHMENT_FOLDER, resolveCalliopeConnectionProfile } from '@/lib/services/calliope/persona';
import { readDraft, ThemeDraftNotFoundError } from '@/lib/themes/drafts';
import { validateChatFile } from '@/lib/chat-files-v2';
import { getErrorMessage } from '@/lib/error-utils';

const logger = createServiceLogger('CalliopeRoute');

// ============================================================================
// Schemas
// ============================================================================

const DraftIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/).max(64);

const createCalliopeChatSchema = z
  .object({
    /** The theme draft the conversation is about. */
    draftId: DraftIdSchema,
    /** Connection profile (model) to start on. Defaults to Calliope's setting, then the default profile. */
    connectionProfileId: z.string().uuid().optional(),
  })
  .strict();

const listSchema = z.object({ draftId: DraftIdSchema });

const discardUploadSchema = z.object({ fileId: z.string().uuid() }).strict();

// ============================================================================
// Handler Functions
// ============================================================================

/** The conversations about one draft, most recent first. */
async function handleList(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;
  const { draftId } = listSchema.parse({ draftId: req.nextUrl.searchParams.get('draftId') ?? '' });

  const chats = (await repos.chats.findCalliopeByThemeDraft(draftId))
    .filter((c) => c.userId === user.id)
    .sort(byChatActivityDesc);

  const enriched = await Promise.all(
    chats.map(async (chat) => {
      const messages = await repos.chats.getMessages(chat.id);
      return {
        id: chat.id,
        title: chat.title,
        themeDraftId: chat.themeDraftId ?? null,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        lastMessageAt: chat.lastMessageAt ?? null,
        messageCount: messages.length,
        consoleConnectionProfileId: chat.consoleConnectionProfileId ?? null,
        attachmentCount: collectAttachmentIds(messages).length,
      };
    })
  );

  logger.debug('Listed Calliope conversations', { draftId, count: enriched.length });
  return successResponse({ chats: enriched });
}

/** Open a conversation about a draft that exists. */
async function handleCreate(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  const body = await req.json().catch(() => ({}));
  const validated = createCalliopeChatSchema.parse(body ?? {});

  try {
    await readDraft(validated.draftId);
  } catch (error) {
    if (error instanceof ThemeDraftNotFoundError) return notFound('Theme draft');
    throw error;
  }

  let profileId: string | null = null;
  if (validated.connectionProfileId) {
    const profile = await repos.connections.findById(validated.connectionProfileId);
    if (!profile || profile.userId !== user.id) return badRequest('Connection profile not found');
    profileId = profile.id;
  } else {
    const profile = await resolveCalliopeConnectionProfile(repos, user.id, null);
    if (!profile) return badRequest('No connection profile available — establish one before summoning Calliope.');
    profileId = profile.id;
  }

  const chat = await repos.chats.create({
    userId: user.id,
    participants: [],
    title: 'A Word with the Muse',
    chatType: 'calliope',
    themeDraftId: validated.draftId,
    consoleConnectionProfileId: profileId,
  });

  logger.info('Calliope conversation opened', { chatId: chat.id, draftId: validated.draftId, connectionProfileId: profileId });
  return created({ chat });
}

/** Store one reference picture (FormData `file`) under `Calliope/` in Quilltap General. */
async function handleUpload(req: NextRequest, context: RequestContext) {
  const { user, repos } = context;

  const formData = await req.formData();
  const file = formData.get('file');
  if (!file || typeof file === 'string') return badRequest('No file provided');

  try {
    validateChatFile(file);
  } catch (error) {
    return badRequest(getErrorMessage(error));
  }

  try {
    const attachment = await storeConsoleAttachment({
      folder: CALLIOPE_ATTACHMENT_FOLDER,
      bytes: Buffer.from(await file.arrayBuffer()),
      filename: file.name,
      mimeType: file.type,
      userId: user.id,
      repos,
    });
    logger.debug('Calliope upload stored', { linkId: attachment.id, path: attachment.path, size: attachment.size });
    return created(attachment);
  } catch (error) {
    logger.error('Calliope upload failed', { filename: file.name, error: getErrorMessage(error) });
    return serverError('The attachment could not be stored');
  }
}

/** Remove an upload dropped before sending, while it is still directly under `Calliope/`. */
async function handleDiscardUpload(req: NextRequest, context: RequestContext) {
  const { repos } = context;
  const { fileId } = discardUploadSchema.parse(await req.json());

  const link = await findConsoleAttachmentLink(CALLIOPE_ATTACHMENT_FOLDER, fileId, repos);
  if (!link) return successResponse({ outcome: 'missing' as const });
  const outcome = await discardConsoleAttachment(CALLIOPE_ATTACHMENT_FOLDER, fileId, repos);
  logger.debug('Calliope upload discarded', { fileId, outcome });
  return successResponse({ outcome });
}

// ============================================================================
// Route Handlers
// ============================================================================

export const GET = createContextHandler(withCollectionActionDispatch({}, handleList));

export const POST = createContextHandler(
  withCollectionActionDispatch(
    {
      upload: handleUpload,
      'discard-upload': handleDiscardUpload,
    },
    handleCreate
  )
);
