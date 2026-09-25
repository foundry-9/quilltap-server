/**
 * Manual Concierge state transitions.
 *
 * The Salon sidebar exposes a four-state per-chat Concierge control. This
 * module is the single chokepoint that translates the requested UI state
 * into the right combination of database writes and synthetic Concierge
 * announcements, so the PUT handler doesn't have to know the rules.
 *
 * State mapping (UI → storage):
 *   - 'monitored'  → conciergeOverride = NULL, isDangerousChat = false
 *   - 'flagged'    → conciergeOverride = NULL, isDangerousChat = true
 *   - 'vouched'    → conciergeOverride = 'OFF', isDangerousChat preserved
 *   - 'uncensored' → conciergeOverride = 'UNCENSORED', isDangerousChat preserved
 *
 * Every transition posts a brief Concierge bubble into the chat so the
 * history remains honest about which mode was in effect when.
 *
 * Not every transition is the operator's. The refusal ledger's auto-switch
 * (`refusal-ledger.ts`) comes through here too, with `{ by: 'concierge' }`, so
 * the Concierge's own decision is written and announced by the same rules.
 */

import type { ChatMetadata } from '@/lib/schemas/types';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  postConciergeManualAnnouncement,
  type ConciergeAutoFlagDetails,
} from '@/lib/services/concierge-notifications/writer';
import { getConciergeState, type ConciergeState } from '@/lib/services/dangerous-content/chat-override';

const logger = createServiceLogger('ConciergeManualFlip');

/** @deprecated alias kept for callers; the canonical type is `ConciergeState`. */
export type ConciergeUIState = ConciergeState;

/**
 * Compute the current UI state from the stored fields. Thin alias over the
 * canonical {@link getConciergeState} so the derivation lives in exactly one
 * place; this writer module is allowed to also read the raw fields below.
 */
export const currentConciergeState = getConciergeState;

/**
 * Who asked for a transition, and why. Omitted means the operator, which is
 * what every caller but the refusal ledger is.
 */
export interface ApplyConciergeFlipOptions {
  by?: 'operator' | 'concierge';
  reason?: 'refusals' | 'classifier';
  /**
   * For `{ by: 'concierge', reason: 'refusals' }`: what the announcement says
   * about the refusals that earned the switch.
   */
  refusals?: ConciergeAutoFlagDetails;
}

/** The dangerCategories stamp an auto-switch leaves, for the header pill's tooltip. */
export const MODERATION_REFUSALS_CATEGORY = 'moderation-refusals';

export interface ApplyConciergeFlipResult {
  /** The state requested by the caller, after normalization. */
  newState: ConciergeUIState;
  /** Whether anything actually changed (false on no-op requests). */
  changed: boolean;
}

/**
 * Apply a manual state change for a chat.
 *
 * - Persists the new combination of `conciergeOverride` and `isDangerousChat`.
 * - Resets classifier metadata when returning to Monitored so the scheduled
 *   scanner can re-evaluate on the next user message.
 * - Posts a synthetic Concierge announcement that reflects the actual
 *   transition (returning to Monitored from an operator state announces the
 *   Concierge's return; a plain Flagged → Monitored announces the all-clear).
 * - Is a no-op when the requested state already matches the stored one.
 */
export async function applyConciergeFlip(
  chatId: string,
  requested: ConciergeUIState,
  chat: ChatMetadata,
  options: ApplyConciergeFlipOptions = {},
): Promise<ApplyConciergeFlipResult> {
  const by = options.by ?? 'operator';
  const current = currentConciergeState(chat);
  if (current === requested) {
    return { newState: requested, changed: false };
  }

  const repos = getRepositories();
  const now = new Date().toISOString();

  switch (requested) {
    case 'flagged': {
      // The operator (or, after enough refusals, the Concierge himself) is
      // marking this chat dangerous. Stamp the classification metadata so the
      // sticky-true rule kicks in and the background scanner leaves it alone.
      // The Concierge's own switch leaves a category so the header pill's
      // tooltip has something to say about why.
      const autoByRefusals = by === 'concierge' && options.reason === 'refusals';
      await repos.chats.update(chatId, {
        conciergeOverride: null,
        isDangerousChat: true,
        dangerScore: null,
        dangerCategories: by === 'concierge' ? [MODERATION_REFUSALS_CATEGORY] : [],
        dangerClassifiedAt: now,
        dangerClassifiedAtMessageCount: chat.messageCount ?? 0,
      });
      if (autoByRefusals) {
        await postConciergeManualAnnouncement({
          chatId,
          kind: 'auto-flagged-refusals',
          details: options.refusals,
        });
      } else {
        await postConciergeManualAnnouncement({ chatId, kind: 'manual-flagged' });
      }
      break;
    }
    case 'monitored': {
      // Returning to Monitored from Flagged or from an operator state.
      // Clearing the classification metadata lets the scheduled scan
      // re-evaluate on the next user message — the user wants future
      // moderation to behave as if we'd never settled the question.
      await repos.chats.update(chatId, {
        conciergeOverride: null,
        isDangerousChat: false,
        dangerScore: null,
        dangerCategories: [],
        dangerClassifiedAt: null,
        dangerClassifiedAtMessageCount: null,
      });
      // A fresh start: stale refusals must not immediately undo the
      // operator's return to Monitored.
      await repos.chats.resetModerationRefusalLedger(chatId);
      const kind = current === 'vouched' || current === 'uncensored'
        ? 'manual-resumed'
        : 'manual-safe';
      await postConciergeManualAnnouncement({ chatId, kind });
      break;
    }
    case 'vouched': {
      // Vouched Safe preserves the prior isDangerousChat so the operator can
      // return to Monitored or Flagged later and pick up where they were.
      await repos.chats.update(chatId, {
        conciergeOverride: 'OFF',
      });
      await postConciergeManualAnnouncement({ chatId, kind: 'manual-vouched' });
      break;
    }
    case 'uncensored': {
      // Uncensored likewise preserves isDangerousChat, so returning to
      // Monitored re-enters the classifier cleanly.
      await repos.chats.update(chatId, {
        conciergeOverride: 'UNCENSORED',
      });
      await postConciergeManualAnnouncement({ chatId, kind: 'manual-uncensored' });
      break;
    }
  }

  logger.info(by === 'concierge' ? 'Concierge state flipped by the Concierge' : 'Concierge state flipped manually', {
    chatId,
    from: current,
    to: requested,
    by,
    reason: options.reason,
  });

  return { newState: requested, changed: true };
}
