/**
 * Character edits → the compiled identity stacks of the chats that seat them.
 *
 * The compiler does not invalidate a chat's cached stack when the character
 * behind a seat is edited (see the compiler's header); a change that must
 * reach running conversations fans out from here instead. Subprompt edits
 * (`lib/subprompts/chat-fanout.ts`) and the Humanoid flag on the physical
 * description (the character PUT handler) both call it.
 *
 * Every LLM-controlled, non-removed seat of the character is a candidate;
 * `seatFilter` narrows that, and `prepareSeat` may write to the seat (and
 * return the updated chat) before it is recompiled. Everything fails soft: a
 * seat that cannot be recompiled logs and is left to the read-through
 * fallback, exactly as the compiler itself behaves. Parent process only.
 *
 * @module system-prompt-compiler/character-fanout
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { compileIdentityStackForParticipant } from '@/lib/services/system-prompt-compiler/compiler';
import { publishRealtime } from '@/lib/realtime/bus';
import type { ChatMetadataBase, ChatParticipantBase } from '@/lib/schemas/types';

const logger = createServiceLogger('SystemPromptCompiler:CharacterFanout');

export interface CharacterSeatFanoutResult {
  /** Chats that had at least one matching seat. */
  chatsTouched: number;
  /** Seats recompiled. */
  seatsRecompiled: number;
}

export interface CharacterSeatFanoutOptions {
  /** Why the fan-out runs, for the logs. */
  reason: string;
  /** Narrows the candidate seats. */
  seatFilter?: (seat: ChatParticipantBase) => boolean;
  /** Runs before a seat's recompile; returns the updated chat when it wrote one. */
  prepareSeat?: (chat: ChatMetadataBase, seat: ChatParticipantBase) => Promise<ChatMetadataBase | null>;
}

/** Recompile the identity stack of every matching seat of `characterId`. */
export async function recompileCharacterSeats(
  characterId: string,
  options: CharacterSeatFanoutOptions,
): Promise<CharacterSeatFanoutResult> {
  const repos = getRepositories();
  let chatsTouched = 0;
  let seatsRecompiled = 0;

  let chats;
  try {
    chats = await repos.chats.findByCharacterId(characterId);
  } catch (error) {
    logger.warn('Could not list chats for identity-stack fan-out', {
      characterId,
      reason: options.reason,
      error: error instanceof Error ? error.message : String(error),
    });
    return { chatsTouched, seatsRecompiled };
  }

  for (const chat of chats) {
    const seats = chat.participants.filter(
      (p) =>
        p.characterId === characterId &&
        p.controlledBy !== 'user' &&
        p.status !== 'removed' &&
        (options.seatFilter ? options.seatFilter(p) : true),
    );
    if (seats.length === 0) continue;
    chatsTouched += 1;

    let current: ChatMetadataBase = chat;
    for (const seat of seats) {
      try {
        if (options.prepareSeat) {
          const updated = await options.prepareSeat(chat, seat);
          if (updated) current = updated;
        }
        await compileIdentityStackForParticipant(current, seat.id);
        seatsRecompiled += 1;
      } catch (error) {
        logger.warn('Failed to recompile a seat in an identity-stack fan-out', {
          chatId: chat.id,
          participantId: seat.id,
          characterId,
          reason: options.reason,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    publishRealtime('chats', chat.id);
  }

  logger.debug('Identity-stack fan-out complete', {
    characterId,
    reason: options.reason,
    chatsTouched,
    seatsRecompiled,
  });
  return { chatsTouched, seatsRecompiled };
}
