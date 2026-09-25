/**
 * Concierge state transitions.
 *
 * The single chokepoint that translates a requested Concierge state into the
 * right database writes and the Concierge's announcement, so no caller has to
 * know the rules. The operator's control (the Salon sidebar, the New Chat
 * form), the refusal ledger's auto-switch and the classifier's verdict all
 * come through here.
 *
 * State mapping (requested → storage):
 *   - 'moderated'   → conciergeMode 'moderated', setBy/reason NULL; the
 *                     classifier's telemetry and the refusal ledger cleared
 *   - 'unmoderated' → conciergeMode 'unmoderated', setBy = by, reason = reason
 *   - 'locked'      → conciergeMode 'locked', setBy 'operator', reason 'manual'
 *
 * `conciergeOverride` is never written: it is legacy, kept only so an old row
 * can be derived.
 *
 * The state is written through `ChatsRepository.setConciergeMode`, never a
 * whole-row `update`. The Concierge's own moves are a compare-and-set against
 * the state he decided on, so a decision made on a snapshot (a classifier run
 * that took seconds, a refusal check that awaited settings) can never
 * overwrite a state the operator chose meanwhile; when the set misses, nothing
 * is announced. Because a buffered write cannot report whether it landed, the
 * Concierge's moves run in the parent process only. Every transition posts a brief Concierge bubble so the
 * history stays honest about which state was in effect when; a change of
 * provenance alone (the operator confirming the Concierge's switch) is
 * written silently.
 */

import type { ChatMetadata } from '@/lib/schemas/types';
import type { ConciergeModeReason, ConciergeModeSetBy } from '@/lib/schemas/chat.types';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  postConciergeDangerAnnouncement,
  postConciergeManualAnnouncement,
  type ConciergeAutoFlagDetails,
  type ConciergeDangerDetails,
} from '@/lib/services/concierge-notifications/writer';
import {
  getConciergeProvenance,
  getConciergeReason,
  getConciergeState,
  type ConciergeState,
} from '@/lib/services/dangerous-content/chat-override';

const logger = createServiceLogger('ConciergeManualFlip');

/**
 * Who asked for a transition, and why. Omitted means the operator, by hand,
 * which is what every caller but the refusal ledger and the classifier is.
 */
export interface ApplyConciergeFlipOptions {
  by?: ConciergeModeSetBy;
  reason?: Exclude<ConciergeModeReason, 'migration'>;
  /**
   * For `{ by: 'concierge', reason: 'refusals' }`: what the announcement says
   * about the refusals that earned the switch.
   */
  refusals?: ConciergeAutoFlagDetails;
  /**
   * For `{ by: 'concierge', reason: 'classifier' }`: the verdict the
   * announcement reports.
   */
  classification?: ConciergeDangerDetails;
}

export interface ApplyConciergeFlipResult {
  /** The state requested by the caller. */
  newState: ConciergeState;
  /** Whether anything was written (false on no-op requests). */
  changed: boolean;
}

/**
 * Move a chat to the requested Concierge state.
 *
 * A no-op when the state already matches and the provenance would not change.
 * When only the provenance changes — the operator choosing Unmoderated on a
 * chat the Concierge already moved there — the provenance is updated without
 * an announcement.
 */
export async function applyConciergeFlip(
  chatId: string,
  requested: ConciergeState,
  chat: Pick<ChatMetadata, 'conciergeMode' | 'conciergeModeSetBy' | 'conciergeModeReason'>,
  options: ApplyConciergeFlipOptions = {},
): Promise<ApplyConciergeFlipResult> {
  const by: ConciergeModeSetBy = options.by ?? 'operator';
  const reason = options.reason ?? 'manual';
  const current = getConciergeState(chat);
  const currentBy = getConciergeProvenance(chat);
  const currentReason = getConciergeReason(chat);

  // The provenance the requested state would carry.
  const nextBy: ConciergeModeSetBy | null = requested === 'moderated'
    ? null
    : requested === 'locked' ? 'operator' : by;
  const nextReason: ConciergeModeReason | null = requested === 'moderated'
    ? null
    : requested === 'locked' ? 'manual' : reason;

  if (current === requested) {
    if (currentBy === nextBy && (currentReason === nextReason || requested === 'moderated')) {
      logger.debug('Concierge flip is a no-op: state and provenance already match', {
        chatId,
        state: current,
        by: currentBy,
        reason: currentReason,
      });
      return { newState: requested, changed: false };
    }
    // Same state, new provenance. The Concierge never overwrites the
    // operator's own choice; the operator may adopt the Concierge's.
    if (by === 'concierge') {
      logger.debug('Concierge flip skipped: the Concierge does not re-attribute a state the operator chose', {
        chatId,
        state: current,
        by: currentBy,
      });
      return { newState: requested, changed: false };
    }
    const repos = getRepositories();
    await repos.chats.setConciergeMode(chatId, {
      conciergeMode: current,
      conciergeModeSetBy: nextBy,
      conciergeModeReason: nextReason,
    });
    logger.info('Concierge state provenance updated', {
      chatId,
      state: current,
      fromBy: currentBy,
      toBy: nextBy,
      fromReason: currentReason,
      toReason: nextReason,
    });
    return { newState: requested, changed: true };
  }

  // The Concierge moves only a Moderated chat, and only to Unmoderated. Locked
  // is the operator's to keep, and returning a chat is the operator's call.
  if (by === 'concierge' && (current !== 'moderated' || requested !== 'unmoderated')) {
    logger.warn('Concierge flip refused: the Concierge may only move a Moderated chat to Unmoderated', {
      chatId,
      from: current,
      to: requested,
      reason,
    });
    return { newState: current, changed: false };
  }

  if (by === 'concierge' && process.env.QUILLTAP_JOB_CHILD === '1') {
    logger.warn('Concierge flip refused in the job child; the parent decides', { chatId, to: requested, reason });
    return { newState: current, changed: false };
  }

  const repos = getRepositories();

  // The operator's choice is authoritative and lands unconditionally; the
  // Concierge's lands only if the chat is still in the state he read.
  const written = await repos.chats.setConciergeMode(
    chatId,
    { conciergeMode: requested, conciergeModeSetBy: nextBy, conciergeModeReason: nextReason },
    by === 'concierge' ? current : undefined,
  );
  if (!written) {
    logger.info('Concierge flip abandoned: the chat changed state since it was read', {
      chatId,
      expected: current,
      to: requested,
      by,
      reason,
    });
    return { newState: current, changed: false };
  }

  switch (requested) {
    case 'moderated': {
      // Clearing the classifier's telemetry lets the scheduled scan
      // re-evaluate on the next user message, and emptying the ledger stops
      // stale refusals from immediately undoing the operator's choice — future
      // moderation behaves as if the question had never been settled.
      await repos.chats.update(chatId, {
        isDangerousChat: false,
        dangerScore: null,
        dangerCategories: [],
        dangerClassifiedAt: null,
        dangerClassifiedAtMessageCount: null,
      });
      await repos.chats.resetModerationRefusalLedger(chatId);
      await postConciergeManualAnnouncement({ chatId, kind: 'set-moderated' });
      break;
    }
    case 'unmoderated': {
      if (by === 'operator') {
        await postConciergeManualAnnouncement({ chatId, kind: 'set-unmoderated' });
      } else if (reason === 'classifier') {
        await postConciergeDangerAnnouncement({ chatId, details: options.classification });
      } else {
        await postConciergeManualAnnouncement({
          chatId,
          kind: 'auto-unmoderated',
          details: options.refusals,
        });
      }
      break;
    }
    case 'locked': {
      await postConciergeManualAnnouncement({ chatId, kind: 'set-locked' });
      break;
    }
  }

  logger.info(by === 'concierge' ? 'Concierge state switched by the Concierge' : 'Concierge state switched by the operator', {
    chatId,
    from: current,
    to: requested,
    by,
    reason: nextReason,
  });

  return { newState: requested, changed: true };
}
