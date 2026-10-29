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
import { recompileCharacterSeats } from '@/lib/services/system-prompt-compiler/character-fanout';

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

  const result = await recompileCharacterSeats(characterId, {
    reason: `subprompt ${subpromptId}`,
    seatFilter: (p) => (p.selectedSubpromptIds ?? []).some((id) => id.toLowerCase() === wanted),
    prepareSeat: options.removeSelection
      ? (chat, seat) => repos.chats.updateParticipant(chat.id, seat.id, {
          selectedSubpromptIds: (seat.selectedSubpromptIds ?? []).filter((id) => id.toLowerCase() !== wanted),
        })
      : undefined,
  });

  logger.info('Subprompt change fanned out', {
    characterId,
    subpromptId,
    removeSelection: options.removeSelection === true,
    chatsTouched: result.chatsTouched,
    seatsRecompiled: result.seatsRecompiled,
  });
  return result;
}
