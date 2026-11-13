/**
 * Brahma Console Messages API v1 Route
 *
 * POST /api/v1/brahma-console/[id]/messages - Send a message, get an SSE stream
 * GET  /api/v1/brahma-console/[id]/messages - Load messages
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, type RequestContext } from '@/lib/api/middleware';
import { z } from 'zod';
import { handleBrahmaConsoleMessage } from '@/lib/services/brahma-console/orchestrator.service';
import { badRequest, successResponse } from '@/lib/api/responses';
import { describeConsoleAttachments, findConsoleAttachmentLink, collectAttachmentIds } from '@/lib/brahma-console/attachments';
import { verifyBrahmaChat } from '../../_shared';

// ============================================================================
// Schemas
// ============================================================================

const sendMessageSchema = z
  .object({
    content: z.string(),
    /** Attachment ids (mount-file link ids under Brahma/ in Quilltap General). */
    fileIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .refine(
    (body) => body.content.trim().length > 0 || (body.fileIds?.length ?? 0) > 0,
    { message: 'Message content is required', path: ['content'] }
  );

// ============================================================================
// Handler Functions
// ============================================================================

async function handleSendMessage(
  req: NextRequest,
  context: RequestContext,
  id: string
): Promise<NextResponse> {
  const { user, repos } = context;

  const result = await verifyBrahmaChat(id, context);
  if (result instanceof NextResponse) return result;

  const body = await req.json();
  const parsed = sendMessageSchema.parse(body);

  // Every attachment must be a Console attachment: a link still directly
  // under Brahma/ in Quilltap General.
  const fileIds = [...new Set(parsed.fileIds ?? [])];
  for (const fileId of fileIds) {
    if (!(await findConsoleAttachmentLink(fileId, repos))) {
      return badRequest(`Attachment ${fileId} is not a Console attachment`);
    }
  }

  const stream = await handleBrahmaConsoleMessage(repos, id, user.id, {
    content: parsed.content,
    fileIds,
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

async function handleGetMessages(
  _req: NextRequest,
  context: RequestContext,
  id: string
): Promise<NextResponse> {
  const { repos } = context;

  const result = await verifyBrahmaChat(id, context);
  if (result instanceof NextResponse) return result;

  const messages = await repos.chats.getMessages(id);

  // Attachments resolved for rendering: name, type, where it lives now, and
  // whether it is gone.
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

  return successResponse({ messages: rendered });
}

// ============================================================================
// Route Handlers
// ============================================================================

export const POST = createContextParamsHandler<{ id: string }>(
  async (req, context, { id }) => {
    return handleSendMessage(req, context, id);
  }
);

export const GET = createContextParamsHandler<{ id: string }>(
  async (req, context, { id }) => {
    return handleGetMessages(req, context, id);
  }
);
