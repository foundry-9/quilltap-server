/**
 * Chats API v1 — Interrupt Actions
 *
 * POST /api/v1/chats/[id]?action=stop-turn   — hard stop
 * POST /api/v1/chats/[id]?action=raise-hand  — soft interrupt ({ raised })
 *
 * The operator's two ways of cutting in on a running Salon stream. Both act on
 * the in-process registry in `lib/chat/turn-control.ts`; the stream itself
 * does the saving and closing, so these handlers only flip state and (for a
 * stop) wait for the stream to finish putting its partial reply away.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { successResponse } from '@/lib/api/responses';
import { isMultiCharacterChat } from '@/lib/chat/turn-manager';
import { setHandRaised, stopActiveTurns } from '@/lib/chat/turn-control';
import { raiseHandSchema } from '../schemas';
import type { RequestContext } from '@/lib/api/middleware';
import type { ChatMetadata } from '@/lib/schemas/types';

/**
 * Hard stop. A room with a rotation is paused first — so the chain's next
 * decision, which re-reads the flag, already sees it — and then every open
 * stream for the chat is aborted. Resolves once they have saved what had
 * streamed (bounded), so the client's refetch finds the kept reply.
 */
export async function handleStopTurn(
  chatId: string,
  chat: ChatMetadata,
  { repos }: RequestContext,
): Promise<NextResponse> {
  const pause = chat.chatType !== 'autonomous' && isMultiCharacterChat(chat.participants);
  if (pause && !chat.isPaused) {
    await repos.chats.update(chatId, { isPaused: true });
  }

  const result = await stopActiveTurns(chatId);
  logger.info('[Interrupt] Stop handled', {
    chatId,
    paused: pause,
    stopped: result.stopped,
    settled: result.settled,
  });

  return successResponse({ stopped: result.stopped, settled: result.settled, paused: pause });
}

/**
 * Soft interrupt. Raises (or lowers) the operator's hand on the open stream;
 * the next character built to speak is asked whether to yield. `active: false`
 * means nothing was running, so the floor is already the operator's.
 */
export async function handleRaiseHand(
  req: NextRequest,
  chatId: string,
): Promise<NextResponse> {
  const { raised } = raiseHandSchema.parse(await req.json().catch(() => ({})));
  const streams = setHandRaised(chatId, raised);
  logger.info('[Interrupt] Hand state changed', { chatId, raised, streams });
  return successResponse({ raised: raised && streams > 0, active: streams > 0 });
}
