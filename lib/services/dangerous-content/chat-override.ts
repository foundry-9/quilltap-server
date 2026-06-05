/**
 * Per-chat Concierge override helpers — the single source of truth for a
 * chat's danger status.
 *
 * Danger lives in two stored fields, `isDangerousChat` (the classification
 * label) and `conciergeOverride` (`'OFF'` = the operator flipped the Concierge
 * off-duty). Neither field is meaningful on its own: off-duty *preserves* the
 * label (so the user can return to Safe or Flagged later) while suppressing
 * every Concierge effect — no classification, no uncensored reroute, no
 * image-prompt scanning, no synthetic Concierge announcements.
 *
 * Because the two fields must always be read together, NOTHING outside this
 * module (and the handful of sanctioned writers/serializers) should read the
 * raw fields. Derive everything from {@link getConciergeState}:
 *
 *   - "Should the Concierge *act* right now?"  → {@link isChatActiveDangerous}
 *   - "What state to *display* / manage?"       → {@link getConciergeState}
 *
 * Reading a raw field on its own is how the override gets silently dropped.
 */

import type { ChatMetadata, ChatMetadataBase } from '@/lib/schemas/types';

type ChatLike = Pick<ChatMetadata, 'conciergeOverride' | 'isDangerousChat'>
  | Pick<ChatMetadataBase, 'conciergeOverride' | 'isDangerousChat'>
  | { conciergeOverride?: 'OFF' | null; isDangerousChat?: boolean | null };

/**
 * The canonical tri-state for a chat's Concierge status. The string values are
 * also the wire contract for the manual-flip control
 * (`PUT /api/v1/chats/[id]` `conciergeState`), so they must stay `'safe' |
 * 'flagged' | 'off'`.
 *
 *   - `'off'`     — operator flipped the Concierge off-duty (`conciergeOverride === 'OFF'`).
 *                   Wins over any classification; the label is preserved underneath.
 *   - `'flagged'` — classified dangerous and on-duty: the Concierge acts.
 *   - `'safe'`    — not classified dangerous (and on-duty).
 */
export type ConciergeState = 'safe' | 'flagged' | 'off';

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
 * THE canonical derivation of a chat's Concierge status from its two stored
 * fields. Every other helper — and every display/management read — should go
 * through this so off-duty can never be silently dropped. Off-duty wins over
 * the classification label.
 */
export function getConciergeState(chat: ChatLike | null | undefined): ConciergeState {
  if (isConciergeOffDuty(chat)) return 'off';
  return chat?.isDangerousChat === true ? 'flagged' : 'safe';
}

/**
 * True iff this chat should be treated as dangerous *right now* — both flagged
 * by classification (auto or manual) and not currently Off-duty.
 *
 * Use this in place of `chat.isDangerousChat === true` everywhere the
 * Concierge would otherwise reroute, sanitize, or pick an uncensored model.
 */
export function isChatActiveDangerous(chat: ChatLike | null | undefined): boolean {
  return getConciergeState(chat) === 'flagged';
}
