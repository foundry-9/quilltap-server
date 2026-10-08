/**
 * Chats API v1 — recall-replay action (episodic recall overhaul §3).
 *
 * POST /api/v1/chats/[id]?action=recall-replay
 * Body (all optional): { turnIndex?: number, characterId?: string, limit?: number, memoryBudget?: number,
 *   tuning?: RecallTuningInput, signals?: <a previous replay's `signals`>, asOf?: boolean }
 *
 * `tuning` applies retuning constants to the new path only; `signals` skips the
 * cheap-LLM distillation and reuses saved signals so runs are comparable;
 * `asOf` searches only memories created before the turn's opening message.
 *
 * Reconstructs the per-turn recall distillation for the given turn and runs
 * the memory search twice — episodic signals inert (pre-overhaul path) vs.
 * live — returning both candidate tables so the retrieval constants can be
 * tuned against real chats. Read-only developer tool; wrapped by
 * `quilltap recall-replay`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { badRequest, successResponse, errorResponse, validationError } from '@/lib/api/responses';
import { runRecallReplay } from '@/lib/memory/recall-replay';
import { RecallReplaySignalsSchema, RecallTuningInputSchema } from '@/lib/memory/recall-tuning';
import type { MemorySearchExtraction } from '@/lib/memory/cheap-llm-tasks';
import { getCheapLLMProvider } from '@/lib/llm/cheap-llm';
import type { RequestContext } from '@/lib/api/middleware';
import type { ChatMetadata } from '@/lib/schemas/types';

export async function handleRecallReplay(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  ctx: RequestContext,
): Promise<NextResponse> {
  const { user, repos } = ctx;

  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw.trim().length > 0) body = JSON.parse(raw);
  } catch {
    return badRequest('Body must be JSON');
  }

  const turnIndex =
    typeof body.turnIndex === 'number' && Number.isInteger(body.turnIndex) && body.turnIndex >= 1
      ? body.turnIndex
      : undefined;
  const characterId = typeof body.characterId === 'string' ? body.characterId : undefined;
  const limit =
    typeof body.limit === 'number' && Number.isInteger(body.limit) && body.limit >= 1
      ? Math.min(body.limit, 100)
      : undefined;

  const memoryBudget =
    typeof body.memoryBudget === 'number' && Number.isFinite(body.memoryBudget) && body.memoryBudget > 0
      ? Math.floor(body.memoryBudget)
      : undefined;

  const tuningParse = RecallTuningInputSchema.optional().safeParse(body.tuning);
  if (!tuningParse.success) {
    return validationError(tuningParse.error);
  }
  const signalsParse = RecallReplaySignalsSchema.optional().safeParse(body.signals);
  if (!signalsParse.success) {
    return validationError(signalsParse.error);
  }
  if (body.asOf !== undefined && typeof body.asOf !== 'boolean') {
    return badRequest('asOf must be a boolean');
  }
  const asOf = body.asOf === true;
  logger.debug('[Chats v1] Recall replay requested', {
    chatId,
    turnIndex,
    tuning: tuningParse.data ?? null,
    signalsPinned: !!signalsParse.data,
    asOf,
  });

  const chatSettings = await repos.chatSettings.findByUserId(user.id);
  if (!chatSettings) {
    return badRequest('Chat settings not found.');
  }
  const availableProfiles = await repos.connections.findByUserId(user.id);
  // Anchor on the first participant's profile when set, else any profile —
  // the cheap-LLM resolver only needs a fallback anchor.
  const participantProfileId = chat.participants.find(p => p.connectionProfileId)?.connectionProfileId;
  const anchorProfile =
    (participantProfileId
      ? availableProfiles.find(p => p.id === participantProfileId)
      : undefined) ?? availableProfiles[0];
  if (!anchorProfile) {
    return badRequest('No connection profiles configured.');
  }

  const cheapLLM = getCheapLLMProvider(
    anchorProfile,
    {
      strategy: chatSettings.cheapLLMSettings.strategy,
      userDefinedProfileId: chatSettings.cheapLLMSettings.userDefinedProfileId ?? undefined,
      defaultCheapProfileId: chatSettings.cheapLLMSettings.defaultCheapProfileId ?? undefined,
      fallbackToLocal: chatSettings.cheapLLMSettings.fallbackToLocal,
    },
    availableProfiles,
  );
  if (!cheapLLM) {
    return badRequest('No cheap LLM provider available.');
  }

  try {
    const result = await runRecallReplay({
      chatId,
      userId: user.id,
      cheapLLM,
      turnIndex,
      characterId,
      limit,
      memoryBudget,
      tuning: tuningParse.data,
      signals: signalsParse.data as MemorySearchExtraction | undefined,
      asOf,
    });
    return successResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Recall replay failed';
    logger.warn('[Chats v1] Recall replay failed', { chatId, error: message });
    return errorResponse(message, 400);
  }
}
