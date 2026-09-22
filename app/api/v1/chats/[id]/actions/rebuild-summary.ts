/**
 * Chats API v1 — Rebuild Summary Action
 *
 * POST /api/v1/chats/[id]?action=rebuild-summary
 *
 * Throws away a chat's running context summary and lets the ordinary fold
 * cadence build a new one from turn 1. The remedy for a summary that has gone
 * wrong — a name the model invented and then carried forward (bug 161) — which
 * until now had no move short of raw SQL.
 *
 * Deliberately *not* the single-shot `forceRegenerate` path: that puts every
 * turn up to the tail floor into one request and will not fit a cheap model's
 * window on a long chat. Clearing the anchor instead means the existing cadence
 * folds FOLD_TURN_BATCH turns at a time, one bounded call per fire, until it is
 * back within FOLD_TRIGGER_DELTA of the head.
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { badRequest, conflict, serverError } from '@/lib/api/responses';
import { enqueueContextSummary } from '@/lib/background-jobs/queue-service';
import { publishRealtime } from '@/lib/realtime/bus';
import type { RequestContext } from '@/lib/api/middleware';
import type { ChatMetadata } from '@/lib/schemas/types';

/**
 * Clear the running summary and enqueue a rebuild.
 */
export async function handleRebuildSummary(
  chatId: string,
  chat: ChatMetadata,
  { user, repos }: RequestContext
): Promise<NextResponse> {
  try {
    // An autonomous room in flight owns its own summary cadence; pulling the
    // anchor out from under a running turn loop is the operator's call to make
    // from a paused room, not ours to make mid-run.
    if (chat.chatType === 'autonomous' && chat.runState === 'running') {
      return conflict('Pause the room before rebuilding its summary.');
    }

    const availableProfiles = await repos.connections.findByUserId(user.id);
    if (availableProfiles.length === 0) {
      return badRequest('No connection profiles available');
    }

    // Same profile precedence as regenerate-title: the cast's own profile when
    // it has one, otherwise whatever is first. The cheap-LLM resolver derives
    // the summariser from it.
    const characterParticipant = chat.participants.find((p) => p.type === 'CHARACTER');
    const participantProfile = characterParticipant?.connectionProfileId
      ? availableProfiles.find((p) => p.id === characterParticipant.connectionProfileId)
      : undefined;
    const connectionProfile = participantProfile ?? availableProfiles[0];

    // One update: summary, its anchor set, and the fold cursor go together, so
    // there is no window where a fold could advance a cursor over a summary
    // that is already gone.
    //
    // `lastFullRebuildTurn` is deliberately left where it is. Zeroing it would
    // put the next gate evaluation over T_HARD_TURN_THRESHOLD on any chat past
    // turn 50 and route the rebuild straight into the single-shot path this
    // action exists to avoid.
    await repos.chats.update(chatId, {
      contextSummary: null,
      summaryAnchorMessageIds: [],
      lastSummaryTurn: 0,
      updatedAt: new Date().toISOString(),
    });

    const jobId = await enqueueContextSummary(user.id, {
      chatId,
      connectionProfileId: connectionProfile.id,
      forceRegenerate: false,
    });

    publishRealtime('chats', chatId);

    logger.info('[Chats v1] Context summary cleared for rebuild', {
      chatId,
      jobId,
      connectionProfileId: connectionProfile.id,
    });

    return NextResponse.json({ success: true, jobId });
  } catch (error) {
    logger.error(
      '[Chats v1] Failed to rebuild context summary',
      { chatId },
      error instanceof Error ? error : new Error(String(error))
    );
    return serverError('Failed to rebuild the summary');
  }
}
