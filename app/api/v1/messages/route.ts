/**
 * Messages API v1 - Collection Endpoint
 *
 * GET /api/v1/messages?chatId= - List messages for a chat
 * GET /api/v1/messages?chatId=&action=transcript&knownVersion= - Conditional Salon transcript read
 * POST /api/v1/messages?chatId= - Send a message (returns streaming SSE response)
 *
 * The POST endpoint returns Server-Sent Events for real-time streaming.
 */

import type { NextRequest, NextResponse } from 'next/server';
import { createContextHandler, type RequestContext } from '@/lib/api/middleware';
import { withCollectionActionDispatch } from '@/lib/api/middleware/actions';
import { projectChatTranscript } from '@/lib/chat/transcript-projection';
import {
  handleSendMessage,
  sendMessageSchema,
  continueMessageSchema,
  buildSendMessageOptions,
  buildContinueMessageOptions,
  sseStreamResponse,
} from '@/lib/services/chat-message';
import { logger } from '@/lib/logger';
import { notFound, badRequest, serverError, successResponse } from '@/lib/api/responses';
import { scrubUserAgent } from '@/lib/utils/user-agent';

/**
 * GET /api/v1/messages?chatId= - List raw message events for a chat.
 *
 * The lightweight listing: stored `type === 'message'` events, unprojected.
 * The Salon's own read is `?action=transcript` below.
 */
async function handleListMessages(req: NextRequest, { user, repos }: RequestContext): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const chatId = searchParams.get('chatId');

  if (!chatId) {
    return badRequest('Query parameter required: chatId');
  }

  try {// Verify chat ownership
    const chat = await repos.chats.findById(chatId);
    if (!chat || chat.userId !== user.id) {
      // `notFound` rather than `forbidden`, matching the per-message endpoints:
      // a chat this account does not own should not be distinguishable from one
      // that does not exist.
      return notFound('Chat');
    }

    // Get messages
    const messages = await repos.chats.getMessages(chatId);

    // Filter to only message events (not system events, context summaries, etc.)
    const messageEvents = messages.filter((m) => m.type === 'message');

    return successResponse({
      messages: messageEvents,
      count: messageEvents.length,
    });
  } catch (error) {
    logger.error('[Messages API v1] Error listing messages', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to list messages');
  }
}

/**
 * GET /api/v1/messages?chatId=&action=transcript&knownVersion=N
 *
 * The Salon's authoritative transcript read, and the one a realtime
 * `{topic:'chats', id}` hint drives. The whole point is that it can answer
 * *nothing changed* without serializing a line of the conversation: the tab
 * hands back the `transcriptVersion` it last saw and gets `{ unchanged: true }`
 * when the counter still agrees.
 *
 * That conditional is not an optimisation but the thing that makes the
 * subscription affordable. One busy turn fires wardrobe, backdrop, whisper and
 * memory hints at the same `chats` topic, and a Commonplace whisper alone can
 * run to 17 KB — so a hint storm must cost round trips, not payloads.
 *
 * Omit `knownVersion` (or pass one that no longer matches) to get the full
 * projection back, identical to the transcript embedded in
 * `GET /api/v1/chats/[id]` because both come from `projectChatTranscript`.
 */
async function handleTranscript(req: NextRequest, { user, repos }: RequestContext): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const chatId = searchParams.get('chatId');

  if (!chatId) {
    return badRequest('Query parameter required: chatId');
  }

  try {
    const chat = await repos.chats.findById(chatId);
    if (!chat || chat.userId !== user.id) {
      return notFound('Chat');
    }

    // Read the counter *before* projecting. The pairing the caller stores must
    // never claim a version newer than the rows beside it: a version read after
    // the projection could have moved on, and the tab would then be answered
    // "unchanged" for a write it has not seen. Reading first can only cost an
    // extra round trip later, which is the harmless direction.
    const version = await repos.chats.getTranscriptVersion(chatId);
    const knownVersionParam = searchParams.get('knownVersion');
    const knownVersion = knownVersionParam === null ? null : Number(knownVersionParam);

    if (knownVersion !== null && Number.isInteger(knownVersion) && knownVersion === version) {
      logger.debug('[Messages API v1] Transcript unchanged', { chatId, version });
      return successResponse({ unchanged: true, version });
    }

    const { messages, offSceneCharacters } = await projectChatTranscript(
      chatId,
      chat,
      repos,
      user.id,
    );

    logger.debug('[Messages API v1] Transcript read', {
      chatId,
      version,
      knownVersion,
      count: messages.length,
    });

    return successResponse({
      unchanged: false,
      version,
      messages,
      offSceneCharacters,
      count: messages.length,
    });
  } catch (error) {
    logger.error('[Messages API v1] Error reading transcript', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to read transcript');
  }
}

export const GET = createContextHandler(
  withCollectionActionDispatch({ transcript: handleTranscript }, handleListMessages),
);

/**
 * POST /api/v1/messages?chatId= - Send a message and get streaming response
 *
 * Returns Server-Sent Events (SSE) stream for real-time response.
 */
export const POST = createContextHandler(async (req, { user, repos }) => {
  // Get chatId from query string
  const { searchParams } = req.nextUrl;
  const chatId = searchParams.get('chatId');

  if (!chatId) {
    return badRequest('Query parameter required: chatId');
  }

  // Validate chatId is a UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(chatId)) {
    return badRequest('Invalid chatId format');
  }

  // Verify chat ownership
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return notFound('Chat');
  }

  // Parse request body
  const body = await req.json();
  const isContinueMode = body.continueMode === true;

  // Capture browser User-Agent for tool use (e.g., curl), scrubbing
  // Electron/Quilltap tokens so it looks like a normal browser.
  const browserUserAgent = scrubUserAgent(req.headers.get('user-agent') || undefined);

  // Validate request based on mode, then build options via the shared helper
  // so the forwarded field set stays in lockstep with /api/v1/chats/[id]/messages.
  const options = isContinueMode
    ? buildContinueMessageOptions(continueMessageSchema.parse(body), { browserUserAgent })
    : buildSendMessageOptions(sendMessageSchema.parse(body), { browserUserAgent });

  const stream = await handleSendMessage(repos, chatId, user.id, options);
  return sseStreamResponse(stream);
});
