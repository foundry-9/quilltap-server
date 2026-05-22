/**
 * Per-chat Concierge override helpers.
 *
 * A chat can opt out of every Concierge effect via `chat.conciergeOverride === 'OFF'`.
 * That value preserves the underlying classification (`isDangerousChat`,
 * `dangerScore`, etc.) so the user can return to Safe or Flagged later — but
 * while the override is on, the chat behaves as if the Concierge were globally
 * off for it: no classification, no uncensored reroute, no image-prompt
 * scanning, no synthetic Concierge announcements.
 *
 * Use the small accessors here at every read site rather than re-deriving the
 * boolean inline, so the rules stay in one place.
 */

import type { ChatMetadata, ChatMetadataBase } from '@/lib/schemas/types';

type ChatLike = Pick<ChatMetadata, 'conciergeOverride' | 'isDangerousChat'>
  | Pick<ChatMetadataBase, 'conciergeOverride' | 'isDangerousChat'>
  | { conciergeOverride?: 'OFF' | null; isDangerousChat?: boolean | null };

/**
 * True iff the operator has flipped the Concierge off-duty for this chat.
 * When true, the Concierge takes no action regardless of `isDangerousChat` or
 * the global moderation mode.
 */
export function isConciergeOffDuty(chat: ChatLike | null | undefined): boolean {
  if (!chat) return false;
  return chat.conciergeOverride === 'OFF';
}

/**
 * True iff this chat should be treated as dangerous *right now* — both flagged
 * by classification (auto or manual) and not currently Off-duty.
 *
 * Use this in place of `chat.isDangerousChat === true` everywhere the
 * Concierge would otherwise reroute, sanitize, or pick an uncensored model.
 */
export function isChatActiveDangerous(chat: ChatLike | null | undefined): boolean {
  if (!chat) return false;
  if (isConciergeOffDuty(chat)) return false;
  return chat.isDangerousChat === true;
}
