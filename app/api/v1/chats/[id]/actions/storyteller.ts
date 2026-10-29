/**
 * Chats API v1 — Storyteller Actions
 *
 * GET  /api/v1/chats/[id]?action=storyteller-round — the chat's open (or running)
 *      round, else its latest closed one (the board's summary line)
 * POST /api/v1/chats/[id]?action=storyteller-run   — run a selection; SSE stream
 * POST /api/v1/chats/[id]?action=storyteller-ask   — "Ask anyway": one late bid
 * POST /api/v1/chats/[id]?action=storyteller-lie   — "Let it lie": choose nobody
 *
 * Rounds open from the ordinary send (an operator post in a storyteller chat);
 * these are the operator's answers to a round. Design of record:
 * docs/developer/features/complete/storyteller-mode.md.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, errorResponse, successResponse } from '@/lib/api/responses';
import {
  askStorytellerAnyway,
  letStorytellerRoundLie,
  StorytellerRoundError,
} from '@/lib/storyteller/round.service';
import { handleStorytellerRun, sseStreamResponse } from '@/lib/services/chat-message';
import { StorytellerAskRequestSchema, StorytellerRunRequestSchema } from '@/lib/schemas/storyteller.types';
import type { RequestContext } from '@/lib/api/middleware';

const StorytellerLieRequestSchema = z.object({ roundId: z.string() });

function roundError(error: unknown, action: string, chatId: string): NextResponse {
  if (error instanceof StorytellerRoundError) {
    logger.info('[Storyteller] Request refused', { chatId, action, reason: error.message });
    return errorResponse(error.message, error.status);
  }
  if (error instanceof z.ZodError) return badRequest('Invalid request');
  throw error;
}

export async function handleGetStorytellerRound(chatId: string, { repos }: RequestContext): Promise<NextResponse> {
  const round =
    (await repos.storytellerRounds.findActiveForChat(chatId)) ??
    (await repos.storytellerRounds.findLatestForChat(chatId));
  return successResponse({ round });
}

export async function handleStorytellerRunAction(
  req: NextRequest,
  chatId: string,
  { repos, user }: RequestContext
): Promise<NextResponse> {
  try {
    const body = StorytellerRunRequestSchema.parse(await req.json());
    logger.info('[Storyteller] Running a selection', {
      chatId,
      roundId: body.roundId,
      count: body.participantIds.length,
      order: body.order ?? 'sequential',
      keepOrder: body.keepOrder === true,
    });
    const stream = await handleStorytellerRun(repos, chatId, user.id, {
      roundId: body.roundId,
      participantIds: body.participantIds,
      order: body.order ?? 'sequential',
      keepOrder: body.keepOrder === true,
    });
    return sseStreamResponse(stream);
  } catch (error) {
    return roundError(error, 'storyteller-run', chatId);
  }
}

export async function handleStorytellerAsk(
  req: NextRequest,
  chatId: string,
  { user }: RequestContext
): Promise<NextResponse> {
  try {
    const body = StorytellerAskRequestSchema.parse(await req.json());
    const bid = await askStorytellerAnyway({ chatId, userId: user.id, ...body });
    return successResponse({ bid });
  } catch (error) {
    return roundError(error, 'storyteller-ask', chatId);
  }
}

export async function handleStorytellerLie(req: NextRequest, chatId: string): Promise<NextResponse> {
  try {
    const body = StorytellerLieRequestSchema.parse(await req.json());
    await letStorytellerRoundLie({ chatId, roundId: body.roundId });
    return successResponse({ closed: true });
  } catch (error) {
    return roundError(error, 'storyteller-lie', chatId);
  }
}
