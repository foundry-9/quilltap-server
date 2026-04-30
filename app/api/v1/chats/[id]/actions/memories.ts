/**
 * Chats API v1 - Memory Actions
 *
 * Handles queue-memories action — enqueues one per-turn MEMORY_EXTRACTION
 * job for every USER message in the chat. Each job rebuilds the turn
 * transcript at execution time and runs user / self / inter-character
 * extraction passes against the joined exchange.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { badRequest } from '@/lib/api/responses';
import { enqueueMemoryExtractionBatch, ensureProcessorRunning } from '@/lib/background-jobs';
import type { AuthenticatedContext } from '@/lib/api/middleware';
import type { ChatMetadata, MessageEvent } from '@/lib/schemas/types';

/**
 * Queue per-turn memory extraction jobs for every USER message in the chat.
 *
 * The legacy version of this action accepted `characterId` / `characterName` /
 * `messagePairs` to scope the rerun to a specific character. Under the
 * per-turn model, each job covers the whole turn (every character that
 * spoke), so character scoping no longer applies — the legacy fields are
 * still accepted by the schema but ignored here.
 */
export async function handleQueueMemories(
  _req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  { user, repos }: AuthenticatedContext
): Promise<NextResponse> {
  const chatSettings = await repos.chatSettings.findByUserId(user.id);
  const cheapLLMSettings = chatSettings?.cheapLLMSettings;

  let connectionProfileId: string | null = null;

  if (cheapLLMSettings?.defaultCheapProfileId) {
    const profile = await repos.connections.findById(cheapLLMSettings.defaultCheapProfileId);
    if (profile && profile.userId === user.id) {
      connectionProfileId = cheapLLMSettings.defaultCheapProfileId;
    }
  }

  if (!connectionProfileId && cheapLLMSettings?.strategy === 'USER_DEFINED' && cheapLLMSettings?.userDefinedProfileId) {
    const profile = await repos.connections.findById(cheapLLMSettings.userDefinedProfileId);
    if (profile && profile.userId === user.id) {
      connectionProfileId = cheapLLMSettings.userDefinedProfileId;
    }
  }

  if (!connectionProfileId) {
    logger.warn('[Chats v1] No valid cheap LLM configured', {
      userId: user.id,
      strategy: cheapLLMSettings?.strategy,
    });
    return badRequest('No valid cheap LLM configured. Please set a cheap LLM profile in settings.');
  }

  // Walk chat history forward and enqueue one job per non-system USER message.
  // Each job covers the turn that opens at that user message (the handler
  // walks forward from there until the next USER to assemble the transcript).
  const messages = await repos.chats.getMessages(chatId);
  const turnOpenerIds: string[] = [];
  for (const m of messages) {
    if (m.type !== 'message') continue;
    const event = m as unknown as MessageEvent;
    if (event.role !== 'USER') continue;
    if (event.systemSender) continue;
    turnOpenerIds.push(event.id);
  }

  if (turnOpenerIds.length === 0) {
    return badRequest('No user messages found in this chat — nothing to extract memories from.');
  }

  logger.info('[Chats v1] Queueing per-turn memory extraction jobs', {
    chatId,
    turnCount: turnOpenerIds.length,
  });

  const jobIds = await enqueueMemoryExtractionBatch(
    user.id,
    chatId,
    connectionProfileId,
    turnOpenerIds,
    { priority: 0 },
  );

  ensureProcessorRunning();

  // Reference `chat` so the linter doesn't flag the unused param —
  // the chat metadata isn't needed under the per-turn model but the route
  // signature still receives it.
  void chat;

  return NextResponse.json({
    success: true,
    jobCount: jobIds.length,
    chatId,
    turnCount: turnOpenerIds.length,
  });
}
