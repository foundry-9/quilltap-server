/**
 * Calliope Messages API v1 Route
 *
 * POST /api/v1/calliope/[id]/messages - Send a message, get an SSE stream
 * GET  /api/v1/calliope/[id]/messages - Load messages, with her proposals judged against the draft as it now is
 *
 * The stream is the console engine's (`legacyFrameEncoder`, as Brahma's).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, type RequestContext } from '@/lib/api/middleware';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { z } from 'zod';
import { badRequest, successResponse } from '@/lib/api/responses';
import { collectAttachmentIds, describeConsoleAttachments, findConsoleAttachmentLink } from '@/lib/console-engine/attachments';
import { CALLIOPE_ATTACHMENT_FOLDER, handleCalliopeMessage } from '@/lib/services/calliope/persona';
import { storedProposals, viewProposal, type ProposalView } from '@/lib/calliope/proposals';
import { readDraft, ThemeDraftNotFoundError } from '@/lib/themes/drafts';

import { verifyCalliopeChat } from '../../_shared';

const logger = createServiceLogger('CalliopeMessagesRoute');

// ============================================================================
// Schemas
// ============================================================================

const sendMessageSchema = z
  .object({
    content: z.string(),
    /** Attachment ids (mount-file link ids under Calliope/ in Quilltap General). */
    fileIds: z.array(z.string().uuid()).max(20).optional(),
  })
  .strict()
  .refine((body) => body.content.trim().length > 0 || (body.fileIds?.length ?? 0) > 0, {
    message: 'Message content is required',
    path: ['content'],
  });

// ============================================================================
// Handler Functions
// ============================================================================

async function handleSendMessage(req: NextRequest, context: RequestContext, id: string): Promise<NextResponse> {
  const { user, repos } = context;
  const result = await verifyCalliopeChat(id, context);
  if (result instanceof NextResponse) return result;

  const parsed = sendMessageSchema.parse(await req.json());

  // Every attachment must still sit directly under Calliope/ in Quilltap General.
  const fileIds = [...new Set(parsed.fileIds ?? [])];
  for (const fileId of fileIds) {
    if (!(await findConsoleAttachmentLink(CALLIOPE_ATTACHMENT_FOLDER, fileId, repos))) {
      return badRequest(`Attachment ${fileId} is not one of Calliope's attachments`);
    }
  }

  const stream = await handleCalliopeMessage(repos, id, user.id, { content: parsed.content, fileIds });
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

async function handleGetMessages(_req: NextRequest, context: RequestContext, id: string): Promise<NextResponse> {
  const { repos } = context;
  const result = await verifyCalliopeChat(id, context);
  if (result instanceof NextResponse) return result;
  const { chat } = result;

  const messages = await repos.chats.getMessages(id);

  // Attachments resolved for rendering, as Brahma's are.
  const views = await describeConsoleAttachments(collectAttachmentIds(messages), repos);
  const rendered = messages.map((m) => {
    if (m.type !== 'message' || !m.attachments || m.attachments.length === 0) return m;
    return {
      ...m,
      attachments: m.attachments.map((attachmentId) => views.get(attachmentId) ?? {
        id: attachmentId,
        filename: 'Missing file',
        mimeType: 'application/octet-stream',
        isImage: false,
        path: null,
        mountPointId: null,
        missing: true,
      }),
    };
  });

  // Her proposals, each judged against the draft as it now is.
  let proposals: ProposalView[] = [];
  let draftMissing = false;
  try {
    const draft = await readDraft(chat.themeDraftId);
    proposals = storedProposals(messages).map((stored) => viewProposal(stored, draft));
  } catch (error) {
    if (!(error instanceof ThemeDraftNotFoundError)) throw error;
    draftMissing = true;
  }
  logger.debug('Loaded Calliope messages', { chatId: id, messages: messages.length, proposals: proposals.length, draftMissing });

  return successResponse({ messages: rendered, proposals, draftMissing });
}

// ============================================================================
// Route Handlers
// ============================================================================

export const POST = createContextParamsHandler<{ id: string }>(async (req, context, { id }) => handleSendMessage(req, context, id));

export const GET = createContextParamsHandler<{ id: string }>(async (req, context, { id }) => handleGetMessages(req, context, id));
