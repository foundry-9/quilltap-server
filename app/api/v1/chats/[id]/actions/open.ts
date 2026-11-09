/**
 * POST /api/v1/chats/[id]?action=open — open a chat that was cast but not yet
 * opened, for a caller that is not the Salon (the CLI, a script).
 *
 * Runs the same stream the Salon opens with (`handleSendMessage` with
 * `opening: true`), draining it here instead of narrating to anyone, and
 * answers once the opening is complete. A chat already opened answers at once.
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import type { RequestContext } from '@/lib/api/middleware';
import { handleSendMessage } from '@/lib/services/chat-message';

export async function handleOpenChat(
  chatId: string,
  { user, repos }: RequestContext,
): Promise<NextResponse> {
  const before = await repos.chats.getOpeningState(chatId);
  if (before.state !== 'done') {
    logger.info('[Chats v1] Opening chat on request', { chatId, state: before.state, phase: before.phase });
    const stream = await handleSendMessage(repos, chatId, user.id, { continueMode: true, opening: true });
    const reader = stream.getReader();
    while (!(await reader.read()).done) { /* drain: nobody is listening */ }
  }
  const after = await repos.chats.getOpeningState(chatId);
  return NextResponse.json({ openingState: after.state });
}
