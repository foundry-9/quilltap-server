/**
 * Subprompt edits → the chats that carry them.
 *
 * A subprompt's text is baked into every chat's compiled identity stack for
 * the seats that have it ticked on, so an edit or a deletion has to reach
 * those chats or the running conversation keeps speaking from yesterday's
 * draft. This is the one place that does that fan-out:
 *
 * - **update** — recompile the stack of every LLM-controlled seat of this
 *   character whose selection includes the subprompt.
 * - **delete** — strip the id from those seats' selections first (so the
 *   record never points at a file that no longer exists), then recompile.
 *
 * Everything fails soft: a chat that cannot be recompiled logs and is left to
 * the read-through fallback, exactly as the compiler itself behaves.
 *
 * @module subprompts/chat-fanout
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { compileIdentityStackForParticipant } from '@/lib/services/system-prompt-compiler/compiler';
import { publishRealtime } from '@/lib/realtime/bus';

const logger = createServiceLogger('Subprompts:Fanout');

export interface SubpromptFanoutResult {
  /** Chats that had at least one seat carrying the subprompt. */
  chatsTouched: number;
  /** Seats recompiled. */
  seatsRecompiled: number;
}

/**
 * Recompile every seat of `characterId` that has `subpromptId` in play. With
 * `removeSelection`, the id is dropped from each such seat's selection before
 * the recompile.
 */
export async function fanOutSubpromptChange(
  characterId: string,
  subpromptId: string,
  options: { removeSelection?: boolean } = {},
): Promise<SubpromptFanoutResult> {
  const repos = getRepositories();
  const wanted = subpromptId.toLowerCase();
  let chatsTouched = 0;
  let seatsRecompiled = 0;

  let chats;
  try {
    chats = await repos.chats.findByCharacterId(characterId);
  } catch (error) {
    logger.warn('Could not list chats for subprompt fan-out', {
      characterId,
      subpromptId,
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
        (p.selectedSubpromptIds ?? []).some((id) => id.toLowerCase() === wanted),
    );
    if (seats.length === 0) continue;
    chatsTouched += 1;

    let current = chat;
    for (const seat of seats) {
      try {
        if (options.removeSelection) {
          const next = (seat.selectedSubpromptIds ?? []).filter((id) => id.toLowerCase() !== wanted);
          const updated = await repos.chats.updateParticipant(chat.id, seat.id, {
            selectedSubpromptIds: next,
          });
          if (updated) current = updated;
        }
        await compileIdentityStackForParticipant(current, seat.id);
        seatsRecompiled += 1;
      } catch (error) {
        logger.warn('Failed to recompile a seat after a subprompt change', {
          chatId: chat.id,
          participantId: seat.id,
          characterId,
          subpromptId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    publishRealtime('chats', chat.id);
  }

  logger.info('Subprompt change fanned out', {
    characterId,
    subpromptId,
    removeSelection: options.removeSelection === true,
    chatsTouched,
    seatsRecompiled,
  });
  return { chatsTouched, seatsRecompiled };
}
