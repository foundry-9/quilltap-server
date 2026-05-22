/**
 * Manual Concierge state transitions.
 *
 * The Salon sidebar exposes a tri-state per-chat Concierge control. This
 * module is the single chokepoint that translates the requested UI state
 * into the right combination of database writes and synthetic Concierge
 * announcements, so the PUT handler doesn't have to know the rules.
 *
 * State mapping (UI → storage):
 *   - 'safe'    → conciergeOverride = NULL, isDangerousChat = false
 *   - 'flagged' → conciergeOverride = NULL, isDangerousChat = true
 *   - 'off'     → conciergeOverride = 'OFF', isDangerousChat preserved
 *
 * Every transition posts a brief Concierge bubble into the chat so the
 * history remains honest about which mode was in effect when.
 */

import type { ChatMetadata } from '@/lib/schemas/types';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { postConciergeManualAnnouncement } from '@/lib/services/concierge-notifications/writer';

const logger = createServiceLogger('ConciergeManualFlip');

export type ConciergeUIState = 'safe' | 'flagged' | 'off';

/**
 * Compute the current UI tri-state from the stored fields. Off-duty wins over
 * any other state — the operator's explicit opt-out always wins.
 */
export function currentConciergeState(
  chat: Pick<ChatMetadata, 'conciergeOverride' | 'isDangerousChat'>,
): ConciergeUIState {
  if (chat.conciergeOverride === 'OFF') return 'off';
  if (chat.isDangerousChat === true) return 'flagged';
  return 'safe';
}

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
 * - Resets classifier metadata when returning to Safe so the scheduled scanner
 *   can re-evaluate on the next user message.
 * - Posts a synthetic Concierge announcement that reflects the actual
 *   transition (Safe → Flagged differs from Safe → Off-duty differs from
 *   Off-duty → Safe).
 * - Is a no-op when the requested state already matches the stored one.
 */
export async function applyConciergeFlip(
  chatId: string,
  requested: ConciergeUIState,
  chat: ChatMetadata,
): Promise<ApplyConciergeFlipResult> {
  const current = currentConciergeState(chat);
  if (current === requested) {
    return { newState: requested, changed: false };
  }

  const repos = getRepositories();
  const now = new Date().toISOString();

  switch (requested) {
    case 'flagged': {
      // The operator is manually marking this chat dangerous. Stamp the
      // classification metadata so the sticky-true rule kicks in and the
      // background scanner leaves it alone.
      await repos.chats.update(chatId, {
        conciergeOverride: null,
        isDangerousChat: true,
        dangerScore: null,
        dangerCategories: [],
        dangerClassifiedAt: now,
        dangerClassifiedAtMessageCount: chat.messageCount ?? 0,
      });
      await postConciergeManualAnnouncement({ chatId, kind: 'manual-flagged' });
      break;
    }
    case 'safe': {
      // Returning to Safe either from Flagged or from Off-duty. Clearing the
      // classification metadata lets the scheduled scan re-evaluate on the
      // next user message — the user wants future moderation to behave as if
      // we'd never settled the question.
      await repos.chats.update(chatId, {
        conciergeOverride: null,
        isDangerousChat: false,
        dangerScore: null,
        dangerCategories: [],
        dangerClassifiedAt: null,
        dangerClassifiedAtMessageCount: null,
      });
      const kind = current === 'off' ? 'manual-on-duty' : 'manual-safe';
      await postConciergeManualAnnouncement({ chatId, kind });
      break;
    }
    case 'off': {
      // Off-duty preserves the prior isDangerousChat so the operator can
      // return to Safe or Flagged later and pick up where they were.
      await repos.chats.update(chatId, {
        conciergeOverride: 'OFF',
      });
      await postConciergeManualAnnouncement({ chatId, kind: 'manual-off-duty' });
      break;
    }
  }

  logger.info('Concierge state flipped manually', {
    chatId,
    from: current,
    to: requested,
  });

  return { newState: requested, changed: true };
}
