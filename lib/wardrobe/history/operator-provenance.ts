/**
 * Operator provenance — who the operator was when they changed an outfit.
 *
 * An operator change (the Wardrobe dialog's Done or slot buttons, Wear again)
 * is recorded against the character the user was speaking as at that moment:
 * the "Speaking As" seat (`activeTypingParticipantId`), impersonation
 * included, falling back to the first user-owned seat — the same resolver
 * that attributes a typed message ({@link findActiveUserParticipant}). A chat
 * where the user drives no character records the operator alone.
 *
 * Server-only.
 *
 * @module lib/wardrobe/history/operator-provenance
 */

import { logger } from '@/lib/logger';
import { findActiveUserParticipant } from '@/lib/chat/turn-manager/utils';
import type { ChatParticipantBase } from '@/lib/schemas/types';
import type { WardrobeHistoryProvenance } from '@/lib/schemas/chat-wardrobe-history.types';

/** The slice of a chat the resolver reads. */
export interface OperatorProvenanceChat {
  id: string;
  participants?: ChatParticipantBase[] | null;
  activeTypingParticipantId?: string | null;
  impersonatingParticipantIds?: readonly string[] | null;
}

/** `{ source: 'operator' }`, naming the user's live character when there is one. */
export function operatorWardrobeProvenance(chat: OperatorProvenanceChat): WardrobeHistoryProvenance {
  const seat = findActiveUserParticipant(
    chat.participants ?? [],
    chat.activeTypingParticipantId,
    chat.impersonatingParticipantIds,
  );
  const actorCharacterId = seat?.characterId ?? undefined;
  logger.debug('Resolved operator for an outfit change', {
    context: 'wardrobe-history',
    chatId: chat.id,
    actorCharacterId: actorCharacterId ?? null,
  });
  return actorCharacterId ? { source: 'operator', actorCharacterId } : { source: 'operator' };
}
