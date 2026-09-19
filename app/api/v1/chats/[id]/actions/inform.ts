/**
 * Chats API v1 - Inform Actions
 *
 * The Salon's **Inform**: an out-of-character passage the operator hands to one
 * or more LLM-controlled seats. Each target receives it verbatim as its own
 * system block on their next generation, and it is then consumed for them.
 *
 * The transcript keeps a record — a Host message carrying exactly what was
 * typed, public when everyone was targeted and whispered to the targets
 * otherwise. The record is for the operator; it never reaches a model.
 *
 * POST /api/v1/chats/[id]?action=inform
 * POST /api/v1/chats/[id]?action=cancel-inform
 * GET  /api/v1/chats/[id]?action=informs
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { badRequest, created, notFound } from '@/lib/api/responses';
import { postInformRecord } from '@/lib/services/announcer/writer';
import { resolveAnnouncementAudience } from '@/lib/services/announcer/audience';
import { publishRealtime } from '@/lib/realtime/bus';
import { getErrorMessage } from '@/lib/error-utils';
import { informSchema, cancelInformSchema } from '../schemas';
import type { RequestContext } from '@/lib/api/middleware';

/**
 * A seat that can be informed: a character still in the room, whose turns an
 * LLM takes. A user-controlled seat never generates, so it could never collect
 * what it was handed. Impersonation is irrelevant here — it is an overlay, not
 * a column write, so an impersonated seat is still `controlledBy: 'llm'` and
 * delivery simply waits for that seat's next *LLM* generation.
 */
function isEligibleSeat(participant: {
  type?: string | null;
  controlledBy?: string | null;
  status?: string | null;
  removedAt?: string | null;
}): boolean {
  return (
    participant.type === 'CHARACTER' &&
    participant.controlledBy === 'llm' &&
    participant.status !== 'removed' &&
    !participant.removedAt
  );
}

/**
 * POST ?action=inform — post one passage to one, several, or every eligible seat.
 */
export async function handleInform(
  req: NextRequest,
  chatId: string,
  { repos }: RequestContext,
): Promise<NextResponse> {
  const body = await req.json();
  const validated = informSchema.parse(body);

  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return notFound('Chat');
  }

  const eligibleIds = chat.participants.filter(isEligibleSeat).map((p) => p.id);
  if (eligibleIds.length === 0) {
    return badRequest('No LLM-controlled seat to inform.');
  }

  let participantIds: string[];
  if (validated.targetParticipantIds === null) {
    participantIds = eligibleIds;
  } else {
    // Membership first (the same gate the whisper audience uses), then
    // eligibility — so an id that names a real seat the operator simply may not
    // inform is reported as such, rather than as an unknown id.
    const audience = await resolveAnnouncementAudience(chatId, validated.targetParticipantIds);
    if (audience.unknownIds.length > 0) {
      return badRequest(
        `Unknown inform target(s) for this chat: ${audience.unknownIds.join(', ')}`,
      );
    }

    const requested = audience.targetParticipantIds ?? [];
    const eligible = new Set(eligibleIds);
    const ineligible = requested.filter((id) => !eligible.has(id));
    if (ineligible.length > 0) {
      return badRequest(
        `Not an LLM-controlled seat in this chat: ${ineligible.join(', ')}`,
      );
    }

    participantIds = requested;
  }

  if (participantIds.length === 0) {
    return badRequest('No LLM-controlled seat to inform.');
  }

  // Coverage, not clicks, decides whether the record is public: an operator who
  // ticks every seat by hand has informed the whole company, and the transcript
  // should say so.
  const coversEveryone = participantIds.length === eligibleIds.length;
  const recordTargets = coversEveryone ? null : participantIds;

  const message = await postInformRecord({
    chatId,
    contentMarkdown: validated.contentMarkdown,
    targetParticipantIds: recordTargets,
  });

  if (!message) {
    // A lost record must not cost the operator the batch — the informs still
    // deliver; only the transcript's note of them is missing.
    logger.warn('[Chats v1] Inform record could not be posted — continuing', {
      chatId,
      targetCount: participantIds.length,
    });
  }

  const rows = await repos.chatInforms.createBatch({
    chatId,
    contentMarkdown: validated.contentMarkdown.trim(),
    participantIds,
    recordMessageId: message?.id ?? null,
  });

  const batchId = rows[0]?.batchId ?? null;

  logger.info('[Chats v1] Inform posted', {
    chatId,
    batchId,
    targetCount: participantIds.length,
    audience: recordTargets ? 'whisper' : 'public',
    recordMessageId: message?.id ?? null,
  });

  return created({
    success: true,
    batchId,
    targetParticipantIds: recordTargets,
    message,
  });
}

/**
 * GET ?action=informs — the pending batches, for the composer's chip.
 *
 * Rows whose seat has left the chat are filtered out defensively; the
 * remove-participant path deletes them, so this only ever catches a row that
 * outlived its seat some other way.
 */
export async function handleGetInforms(
  chatId: string,
  { repos }: RequestContext,
): Promise<NextResponse> {
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return notFound('Chat');
  }

  const current = new Set(
    chat.participants
      .filter((p) => !p.removedAt && p.status !== 'removed')
      .map((p) => p.id),
  );

  const all = await repos.chatInforms.findPendingBatches(chatId);
  const batches = all
    .map((batch) => ({
      ...batch,
      pendingParticipantIds: batch.pendingParticipantIds.filter((id) => current.has(id)),
    }))
    .filter((batch) => batch.pendingParticipantIds.length > 0);

  logger.debug('[Chats v1] Pending informs listed', {
    chatId,
    batches: batches.length,
    dropped: all.length - batches.length,
  });

  return NextResponse.json({ batches });
}

/**
 * POST ?action=cancel-inform — withdraw a batch's still-pending targets.
 *
 * A seat that already read the passage keeps its consumed row (a later swipe of
 * that turn must still re-apply it), and the record stays with it. When nothing
 * was consumed the record goes too: it would otherwise document something that
 * never happened.
 */
export async function handleCancelInform(
  req: NextRequest,
  chatId: string,
  { repos }: RequestContext,
): Promise<NextResponse> {
  const body = await req.json();
  const { batchId } = cancelInformSchema.parse(body);

  const rows = await repos.chatInforms.findByBatchId(batchId);
  if (rows.length === 0) {
    return notFound('Inform batch');
  }
  if (rows.some((row) => row.chatId !== chatId)) {
    return badRequest('That inform belongs to another conversation.');
  }

  const anyConsumed = rows.some((row) => Boolean(row.consumedAt));
  const recordMessageId = rows.find((row) => row.recordMessageId)?.recordMessageId ?? null;

  const removed = await repos.chatInforms.deletePendingByBatch(batchId);

  let recordDeleted = false;
  if (!anyConsumed && recordMessageId) {
    try {
      const deleted = await repos.chats.deleteMessagesByIds(chatId, [recordMessageId]);
      recordDeleted = deleted > 0;
    } catch (error) {
      // The rows are already gone; a surviving record is untidy, not broken.
      logger.warn('[Chats v1] Could not delete inform record message', {
        chatId,
        batchId,
        recordMessageId,
        error: getErrorMessage(error),
      });
    }
  }

  // Deleting pending rows touches no message row, so nothing else fires the
  // hint that refreshes the composer's chip.
  publishRealtime('chats', chatId);

  logger.debug('[Chats v1] Inform cancelled', {
    chatId,
    batchId,
    removed,
    anyConsumed,
    recordDeleted,
  });

  return NextResponse.json({ success: true, removed, recordDeleted });
}
