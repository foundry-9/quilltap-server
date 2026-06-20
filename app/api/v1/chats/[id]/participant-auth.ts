/**
 * Chats API v1 - Participant authorization predicate
 *
 * A dependency-free helper (type-only imports) so the lightweight action
 * handlers that gate on it — the Post Office "list mailbox" and "compose mail"
 * actions — don't transitively pull in the request middleware.
 */

import type { ChatMetadata } from '@/lib/schemas/types';

/**
 * Find the participant for a character the operator actually *plays* in this
 * chat: a CHARACTER participant they control (`controlledBy === 'user'`) that
 * hasn't been removed. Security-load-bearing — the Post Office "list mailbox"
 * and "compose mail" actions both gate on it so the operator can only act as a
 * character they are playing, never an LLM character or a stranger. Returns the
 * participant, or `undefined` when no such participant exists.
 */
export function findOperatorPlayedParticipant(
  chat: ChatMetadata,
  characterId: string,
): ChatMetadata['participants'][number] | undefined {
  return chat.participants.find(
    (p) =>
      p.type === 'CHARACTER'
      && p.characterId === characterId
      && p.controlledBy === 'user'
      && !p.removedAt,
  );
}
